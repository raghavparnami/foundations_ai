/**
 * Wiki data layer.
 *
 * Wiki pages are unified across three corpora (tables / docs / code).
 * Every operation is content-hash-gated so the agent's tick is a no-op when
 * nothing changed. Every create/update/skip is mirrored to `audit_log` so the
 * Activity feed shows a real trail of what the wiki agents did.
 */
import { createHash } from "node:crypto";
import { catalogPool } from "./db";
import { audit } from "./queries";

export type WikiKind = "tables" | "docs" | "code";

export type WikiPageInput = {
  kind: WikiKind;
  slug: string;
  title: string;
  summary?: string | null;
  body_md: string;
  source_ref?: unknown;
};

export type WikiPageRow = {
  id: number;
  kind: WikiKind;
  slug: string;
  title: string;
  summary: string | null;
  body_md: string;
  source_ref: unknown;
  content_hash: string;
  status: string;
  generated_at: string | null;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
};

export function pageHash(body_md: string, source_ref: unknown): string {
  return createHash("md5")
    .update(body_md)
    .update("\n")
    .update(JSON.stringify(source_ref ?? null))
    .digest("hex");
}

/**
 * Upsert a wiki page with hash-gated update. Returns:
 *   { action: 'created' | 'updated' | 'skipped' }
 *
 * `skipped` means the content_hash matched; we touched last_seen_at so the
 * janitor doesn't think the page was abandoned.
 */
export async function upsertWikiPage(
  actor: string,
  input: WikiPageInput,
): Promise<{ action: "created" | "updated" | "skipped"; id: number }> {
  const hash = pageHash(input.body_md, input.source_ref);
  // Existing?
  const existing = await catalogPool.query<{ id: number; content_hash: string }>(
    `SELECT id, content_hash FROM wiki_pages WHERE kind = $1 AND slug = $2`,
    [input.kind, input.slug],
  );
  if (existing.rows[0]) {
    const row = existing.rows[0];
    if (row.content_hash === hash) {
      await catalogPool.query(`UPDATE wiki_pages SET last_seen_at = NOW() WHERE id = $1`, [row.id]);
      await audit(actor, "wiki:page_skip", `${input.kind}/${input.slug}`, { id: row.id, reason: "hash_match" });
      return { action: "skipped", id: row.id };
    }
    await catalogPool.query(
      `UPDATE wiki_pages
          SET title = $2,
              summary = $3,
              body_md = $4,
              source_ref = $5::jsonb,
              content_hash = $6,
              status = 'ready',
              generated_at = NOW(),
              last_seen_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [row.id, input.title, input.summary ?? null, input.body_md, JSON.stringify(input.source_ref ?? null), hash],
    );
    await replaceLinks(row.id, input.body_md);
    await audit(actor, "wiki:page_update", `${input.kind}/${input.slug}`, {
      id: row.id,
      bytes: input.body_md.length,
    });
    return { action: "updated", id: row.id };
  }
  const r = await catalogPool.query<{ id: number }>(
    `INSERT INTO wiki_pages (kind, slug, title, summary, body_md, source_ref, content_hash, status, generated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 'ready', NOW())
     RETURNING id`,
    [input.kind, input.slug, input.title, input.summary ?? null, input.body_md, JSON.stringify(input.source_ref ?? null), hash],
  );
  const id = r.rows[0]!.id;
  await replaceLinks(id, input.body_md);
  await audit(actor, "wiki:page_create", `${input.kind}/${input.slug}`, {
    id,
    bytes: input.body_md.length,
  });
  return { action: "created", id };
}

/**
 * Mark pages that haven't been seen for N hours as stale. The runner
 * touches last_seen_at on every tick, so a stale page is one whose
 * source disappeared.
 */
export async function markStaleWikiPages(actor: string, kind: WikiKind, olderThanHours: number = 24) {
  const r = await catalogPool.query<{ id: number; slug: string }>(
    `UPDATE wiki_pages
        SET status = 'stale'
      WHERE kind = $1 AND status = 'ready'
        AND last_seen_at < NOW() - ($2 || ' hours')::interval
     RETURNING id, slug`,
    [kind, String(olderThanHours)],
  );
  for (const row of r.rows) {
    await audit(actor, "wiki:page_stale", `${kind}/${row.slug}`, { id: row.id, hours: olderThanHours });
  }
  return r.rowCount ?? 0;
}

/**
 * Reset the agent's "in-progress" lock + write a status row. Called
 * around every wiki agent tick.
 */
export async function beginAgentTick(kind: WikiKind): Promise<boolean> {
  // Try to claim the soft lock. Returns true if claimed.
  const r = await catalogPool.query<{ kind: WikiKind }>(
    `UPDATE wiki_agent_state
        SET is_running = TRUE
      WHERE kind = $1 AND is_running = FALSE
     RETURNING kind`,
    [kind],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function endAgentTick(
  kind: WikiKind,
  status: "ok" | "failed",
  pagesGenerated: number,
  error?: string,
): Promise<void> {
  await catalogPool.query(
    `UPDATE wiki_agent_state
        SET is_running = FALSE,
            last_run_at = NOW(),
            last_status = $2,
            last_error = $3,
            pages_generated = pages_generated + $4
      WHERE kind = $1`,
    [kind, status, error ?? null, pagesGenerated],
  );
}

async function replaceLinks(fromPageId: number, body_md: string): Promise<void> {
  await catalogPool.query(`DELETE FROM wiki_links WHERE from_page_id = $1`, [fromPageId]);
  const refs = parseWikiLinks(body_md);
  if (refs.length === 0) return;
  for (const r of refs) {
    await catalogPool.query(
      `INSERT INTO wiki_links (from_page_id, to_kind, to_slug)
         VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [fromPageId, r.kind, r.slug],
    );
  }
}

/**
 * Cross-link syntax: [[tables/deviations]], [[docs/qa-runbook]], or just
 * [[deviations]] (defaults to current page's kind — but at parse time we
 * don't know it; require the explicit `kind/slug` form).
 */
export function parseWikiLinks(md: string): { kind: WikiKind; slug: string }[] {
  const out: { kind: WikiKind; slug: string }[] = [];
  const re = /\[\[(tables|docs|code)\/([a-z0-9][a-z0-9-_]{1,80})\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    out.push({ kind: m[1] as WikiKind, slug: m[2]! });
  }
  return out;
}

export async function listWikiPages(kind?: WikiKind): Promise<WikiPageRow[]> {
  const r = await catalogPool.query<WikiPageRow>(
    kind
      ? `SELECT id, kind, slug, title, summary, body_md, source_ref, content_hash, status, generated_at::text, last_seen_at::text, created_at::text, updated_at::text
           FROM wiki_pages WHERE kind = $1 ORDER BY title ASC`
      : `SELECT id, kind, slug, title, summary, body_md, source_ref, content_hash, status, generated_at::text, last_seen_at::text, created_at::text, updated_at::text
           FROM wiki_pages ORDER BY kind, title ASC`,
    kind ? [kind] : [],
  );
  return r.rows;
}

export async function getWikiPage(kind: WikiKind, slug: string): Promise<WikiPageRow | null> {
  const r = await catalogPool.query<WikiPageRow>(
    `SELECT id, kind, slug, title, summary, body_md, source_ref, content_hash, status, generated_at::text, last_seen_at::text, created_at::text, updated_at::text
       FROM wiki_pages WHERE kind = $1 AND slug = $2`,
    [kind, slug],
  );
  return r.rows[0] ?? null;
}

export async function getBacklinks(toKind: WikiKind, toSlug: string): Promise<WikiPageRow[]> {
  const r = await catalogPool.query<WikiPageRow>(
    `SELECT p.id, p.kind, p.slug, p.title, p.summary, p.body_md, p.source_ref, p.content_hash, p.status,
            p.generated_at::text, p.last_seen_at::text, p.created_at::text, p.updated_at::text
       FROM wiki_links l
       JOIN wiki_pages p ON p.id = l.from_page_id
      WHERE l.to_kind = $1 AND l.to_slug = $2
      ORDER BY p.title`,
    [toKind, toSlug],
  );
  return r.rows;
}
