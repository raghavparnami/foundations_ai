/**
 * Agent memory — two tiers.
 *
 *   - **Short-term** (`tier='short'`): auto-saved at the end of every chat
 *     turn, deterministic summary of "what the user asked + which tables /
 *     joins / skills were used + the SQL approach". TTL = 7 days. No LLM
 *     call (cost = 0). Retrieved on matching keywords so follow-up questions
 *     within the week have rich context.
 *   - **Long-term** (`tier='long'`): user-curated. Facts, rules, prefs,
 *     glossary. Never expires. Edited via /memory UI. The agent's `remember`
 *     tool writes here. Long-term *approaches* are NOT stored here — they
 *     go through `propose_skill` (the skills table), since skills already
 *     have UI cards, retrieval, and acceptance flow.
 *
 * Per-conversation short context (the running chat's own summary +
 * pinned_facts) lives on `conversations.summary_md` + `pinned_facts`,
 * separate from this table. See `getConversationSnapshot` below.
 */
import { catalogPool } from "./db";

export type MemoryScope = "user" | "workspace";
export type MemoryKind = "preference" | "fact" | "rule" | "glossary" | "other";
export type MemorySource = "user" | "agent" | "auto";
export type MemoryTier = "short" | "long";

export const SHORT_TERM_TTL_DAYS = 7;

export type MemoryRow = {
  id: number;
  scope: MemoryScope;
  kind: MemoryKind;
  content: string;
  importance: number;
  source: MemorySource;
  tier: MemoryTier;
  expires_at: string | null;
  conversation_id: string | null;
  status: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  use_count: number;
};

export type MemoryInput = {
  scope: MemoryScope;
  kind: MemoryKind;
  content: string;
  importance?: number;
  source?: MemorySource;
  tier?: MemoryTier;
  expires_at?: string | null;
  conversation_id?: string | null;
};

export async function insertMemory(m: MemoryInput): Promise<MemoryRow> {
  const r = await catalogPool.query<MemoryRow>(
    `INSERT INTO memories (scope, kind, content, importance, source, tier, expires_at, conversation_id)
       VALUES ($1, $2, $3, COALESCE($4, 3), COALESCE($5, 'agent'), COALESCE($6, 'long'), $7, $8)
     RETURNING id, scope, kind, content, importance, source, tier, expires_at::text,
               conversation_id, status, enabled, created_at::text, updated_at::text,
               last_used_at::text, use_count`,
    [
      m.scope,
      m.kind,
      m.content.trim(),
      m.importance ?? null,
      m.source ?? null,
      m.tier ?? null,
      m.expires_at ?? null,
      m.conversation_id ?? null,
    ],
  );
  return r.rows[0]!;
}

/**
 * Save a deterministic 7-day short-term memory of the current chat turn.
 * Cost: one INSERT, no LLM call. The content is built from the user's
 * question + a compact list of tables / joins / skills the agent touched,
 * so future turns can recall "you asked something similar last Tuesday
 * and we used these tables".
 */
export async function autoSaveShortTerm(opts: {
  conversation_id: string;
  user_question: string;
  approach_summary: string;
}): Promise<MemoryRow | null> {
  const content = `Q: ${opts.user_question.trim().slice(0, 280)}\n${opts.approach_summary.trim().slice(0, 600)}`;
  if (content.length < 20) return null;
  const expiresAt = new Date(Date.now() + SHORT_TERM_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return insertMemory({
    scope: "user",
    kind: "other",
    content,
    importance: 2,
    source: "auto",
    tier: "short",
    expires_at: expiresAt,
    conversation_id: opts.conversation_id,
  });
}

/** Delete expired short-term rows. Called by the scheduler each tick. */
export async function pruneExpiredMemories(): Promise<number> {
  const r = await catalogPool.query<{ count: string }>(
    `WITH d AS (
       DELETE FROM memories
        WHERE tier = 'short' AND expires_at IS NOT NULL AND expires_at < NOW()
        RETURNING 1
     )
     SELECT count(*)::text AS count FROM d`,
  );
  return Number(r.rows[0]?.count ?? 0);
}

export async function listMemories(opts: {
  scope?: MemoryScope;
  includeArchived?: boolean;
  limit?: number;
} = {}): Promise<MemoryRow[]> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (!opts.includeArchived) where.push(`status = 'active' AND enabled = TRUE`);
  if (opts.scope) {
    args.push(opts.scope);
    where.push(`scope = $${args.length}`);
  }
  const limit = Math.min(200, opts.limit ?? 100);
  const sql = `
    SELECT id, scope, kind, content, importance, source, conversation_id, status,
           enabled, created_at::text, updated_at::text, last_used_at::text, use_count
      FROM memories
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY importance DESC, COALESCE(last_used_at, created_at) DESC
     LIMIT ${limit}
  `;
  const r = await catalogPool.query<MemoryRow>(sql, args);
  return r.rows;
}

/**
 * Find memories relevant to a user query. Hybrid scoring:
 *   - exact phrase substring match → big bonus
 *   - per-word token match → small bonus per hit
 *   - importance + last_used_at break ties
 */
export async function matchMemories(query: string, k = 6): Promise<MemoryRow[]> {
  const all = await listMemories({ limit: 200 });
  if (all.length === 0) return [];
  const q = query.trim().toLowerCase();
  const words = q.split(/\W+/).filter((w) => w.length >= 3);

  const scored = all.map((m) => {
    const text = m.content.toLowerCase();
    let score = 0;
    if (text.includes(q)) score += 10;
    for (const w of words) if (text.includes(w)) score += 2;
    // Importance + recency tiebreaker
    score += m.importance;
    if (m.last_used_at) {
      const ageH = (Date.now() - new Date(m.last_used_at).getTime()) / 3_600_000;
      score += Math.max(0, 2 - ageH / 24); // recently used = small boost
    }
    return { m, score };
  });

  return scored
    .filter((x) => x.score > 3) // floor: must have at least some match beyond importance
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.m);
}

export async function touchMemories(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await catalogPool.query(
    `UPDATE memories
        SET last_used_at = NOW(), use_count = use_count + 1
      WHERE id = ANY($1::int[])`,
    [ids],
  );
}

export async function updateMemory(
  id: number,
  patch: Partial<Pick<MemoryRow, "content" | "importance" | "scope" | "kind" | "enabled" | "status">>,
): Promise<MemoryRow | null> {
  const sets: string[] = [];
  const args: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    args.push(v);
    sets.push(`${k} = $${args.length}`);
  }
  if (sets.length === 0) return null;
  args.push(id);
  const r = await catalogPool.query<MemoryRow>(
    `UPDATE memories SET ${sets.join(", ")}, updated_at = NOW()
      WHERE id = $${args.length}
     RETURNING id, scope, kind, content, importance, source, conversation_id, status,
               enabled, created_at::text, updated_at::text, last_used_at::text, use_count`,
    args,
  );
  return r.rows[0] ?? null;
}

export async function deleteMemory(id: number): Promise<void> {
  await catalogPool.query(`DELETE FROM memories WHERE id = $1`, [id]);
}

// ─── Short-term: per-conversation summary + pinned facts ─────────────────

export type ConversationSnapshot = {
  summary_md: string | null;
  pinned_facts: string[];
  last_summarized_at: string | null;
  summarized_turn_count: number;
};

export async function getConversationSnapshot(slug: string): Promise<ConversationSnapshot | null> {
  const r = await catalogPool.query<{
    summary_md: string | null;
    pinned_facts: string[] | null;
    last_summarized_at: string | null;
    summarized_turn_count: number;
  }>(
    `SELECT summary_md, pinned_facts, last_summarized_at::text, summarized_turn_count
       FROM conversations WHERE slug = $1`,
    [slug],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    summary_md: row.summary_md,
    pinned_facts: Array.isArray(row.pinned_facts) ? row.pinned_facts : [],
    last_summarized_at: row.last_summarized_at,
    summarized_turn_count: row.summarized_turn_count ?? 0,
  };
}

export async function pinFact(slug: string, fact: string): Promise<void> {
  await catalogPool.query(
    `UPDATE conversations
        SET pinned_facts = pinned_facts || $2::jsonb,
            updated_at = NOW()
      WHERE slug = $1`,
    [slug, JSON.stringify([fact.trim()])],
  );
}

export async function setConversationSummary(
  slug: string,
  summary_md: string,
  turnCount: number,
): Promise<void> {
  await catalogPool.query(
    `UPDATE conversations
        SET summary_md = $2,
            last_summarized_at = NOW(),
            summarized_turn_count = $3,
            updated_at = NOW()
      WHERE slug = $1`,
    [slug, summary_md, turnCount],
  );
}
