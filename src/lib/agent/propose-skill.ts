/**
 * Implementation of the `propose_skill` agent tool.
 *
 * The agent calls this when a chat has produced canonizable knowledge — a
 * domain definition, a formula, a "the way we measure X" rule — that's worth
 * pinning so future chats trigger the same playbook.
 *
 * IMPORTANT: this tool does NOT create the skill immediately. It stages a
 * candidate in `skill_candidates` with status='pending'. The UI surfaces a
 * card; user accept/dismiss writes the final row in `skills`.
 *
 * This separation matters: skills steer the agent on every matching turn, so
 * we should never auto-add one without user approval.
 */
import { catalogPool } from "../catalog/db";
import { audit } from "../catalog/queries";

export type ProposeSkillInput = {
  name: string;
  description: string;
  triggers: string[];
  body_md: string;
  conversationId: string | null;
};

export type ProposeSkillResult =
  | { ok: true; candidate_id: number; slug: string }
  | { ok: false; error: string };

export async function proposeSkillCandidate(
  input: ProposeSkillInput,
): Promise<ProposeSkillResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "name is required" };
  const desc = input.description.trim();
  if (!desc) return { ok: false, error: "description is required" };
  const triggers = Array.isArray(input.triggers)
    ? input.triggers.map((t) => String(t).trim()).filter(Boolean)
    : [];
  if (triggers.length === 0) {
    return { ok: false, error: "at least one trigger keyword is required" };
  }
  const body = input.body_md.trim();
  if (body.length < 40) {
    return {
      ok: false,
      error: "body_md must be substantive — include 'What it is', a formula or SQL template, and 'When to use'.",
    };
  }

  const slug = sanitizeSlug(name);
  if (!slug) return { ok: false, error: "invalid name (use letters/digits/hyphens)" };

  // Dedupe: if there's an existing PENDING candidate with the same slug in
  // this conversation, just update it. Avoids the agent spamming dupes.
  const r = await catalogPool.query<{ id: number }>(
    `INSERT INTO skill_candidates (conversation_id, slug, name, description, triggers, body_md)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [input.conversationId, slug, name, desc, JSON.stringify(triggers), body],
  );
  let id = r.rows[0]?.id;

  if (id === undefined) {
    // No conflict constraint matched (we don't have one — fallback path is
    // a manual lookup of an existing pending row in this conversation).
    const lookup = await catalogPool.query<{ id: number }>(
      `SELECT id FROM skill_candidates
        WHERE conversation_id = $1 AND slug = $2 AND status = 'pending'
        ORDER BY created_at DESC LIMIT 1`,
      [input.conversationId, slug],
    );
    if (lookup.rows[0]) {
      id = lookup.rows[0].id;
      await catalogPool.query(
        `UPDATE skill_candidates
            SET name = $2, description = $3, triggers = $4::jsonb, body_md = $5
          WHERE id = $1`,
        [id, name, desc, JSON.stringify(triggers), body],
      );
    } else {
      // Last resort: insert fresh.
      const fresh = await catalogPool.query<{ id: number }>(
        `INSERT INTO skill_candidates (conversation_id, slug, name, description, triggers, body_md)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING id`,
        [input.conversationId, slug, name, desc, JSON.stringify(triggers), body],
      );
      id = fresh.rows[0]!.id;
    }
  }

  await audit("agent", "propose_skill", slug, {
    conversationId: input.conversationId,
    candidate_id: id,
    triggers: triggers.length,
  });

  return { ok: true, candidate_id: id, slug };
}

function sanitizeSlug(raw: string): string | null {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return /^[a-z][a-z0-9-]{1,60}$/.test(s) ? s : null;
}
