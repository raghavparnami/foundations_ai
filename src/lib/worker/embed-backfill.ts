/**
 * Embedding backfill. Runs each scheduler tick.
 *
 *   - For every table with a doc, embed the doc if (no embedding) OR
 *     (content_hash changed since last embed).
 *   - For every wiki_page, embed body_md + title + summary on the same rules.
 *
 * Batched in groups of 64 to amortize the API call. Cheap: at 10K tables
 * the cold backfill is ~$0.10 one-time; steady state is $0.0001/day churn.
 *
 * The function is a no-op when OPENAI_API_KEY is unset — retrieval falls
 * back to tsvector-only (BM25) lexical search until a key is provided.
 */
import { createHash } from "node:crypto";
import { catalogPool } from "../catalog/db";
import { embedMany, embeddingsEnabled, toPgVectorLiteral } from "./embed";
import { log } from "../shared/log";

const TABLE_BATCH = 64;
const WIKI_BATCH = 64;

export async function runEmbedBackfill(): Promise<{
  tables_embedded: number;
  wiki_embedded: number;
  skipped: number;
}> {
  if (!embeddingsEnabled()) {
    return { tables_embedded: 0, wiki_embedded: 0, skipped: 0 };
  }
  const t0 = Date.now();
  const tablesEmbedded = await embedDirtyTables();
  const wikiEmbedded = await embedDirtyWiki();
  log.info("embed.backfill", {
    tables_embedded: tablesEmbedded,
    wiki_embedded: wikiEmbedded,
    ms: Date.now() - t0,
  });
  return { tables_embedded: tablesEmbedded, wiki_embedded: wikiEmbedded, skipped: 0 };
}

async function embedDirtyTables(): Promise<number> {
  // Pull rows that either have no embedding row at all, or have one with a
  // stale content_hash. LIMIT keeps each tick's API spend bounded.
  const rows = await catalogPool.query<{
    table_id: number;
    schema_name: string;
    table_name: string;
    markdown: string;
  }>(
    `SELECT t.id AS table_id, t.schema_name, t.table_name, d.markdown
       FROM tables t
       JOIN docs d ON d.table_id = t.id
       LEFT JOIN embeddings e ON e.table_id = t.id
      WHERE e.id IS NULL
         OR e.content_hash IS DISTINCT FROM md5(d.markdown)
      ORDER BY t.id
      LIMIT $1`,
    [TABLE_BATCH],
  );
  if (rows.rows.length === 0) return 0;

  const texts = rows.rows.map(buildTableEmbedText);
  const vecs = await embedMany(texts);
  if (!vecs) return 0;

  for (let i = 0; i < rows.rows.length; i++) {
    const r = rows.rows[i]!;
    const v = vecs[i];
    if (!v) continue;
    const hash = md5(r.markdown);
    await catalogPool.query(
      `INSERT INTO embeddings (table_id, vec, content_hash, updated_at)
       VALUES ($1, $2::vector, $3, NOW())
       ON CONFLICT (table_id) DO UPDATE
         SET vec = EXCLUDED.vec,
             content_hash = EXCLUDED.content_hash,
             updated_at = NOW()`,
      [r.table_id, toPgVectorLiteral(v), hash],
    );
  }
  return rows.rows.length;
}

async function embedDirtyWiki(): Promise<number> {
  const rows = await catalogPool.query<{
    id: number;
    title: string;
    summary: string | null;
    body_md: string;
    content_hash: string;
  }>(
    `SELECT id, title, summary, body_md, content_hash
       FROM wiki_pages
      WHERE embedded_hash IS DISTINCT FROM content_hash
      ORDER BY updated_at DESC
      LIMIT $1`,
    [WIKI_BATCH],
  );
  if (rows.rows.length === 0) return 0;

  const texts = rows.rows.map((r) => buildWikiEmbedText(r));
  const vecs = await embedMany(texts);
  if (!vecs) return 0;

  for (let i = 0; i < rows.rows.length; i++) {
    const r = rows.rows[i]!;
    const v = vecs[i];
    if (!v) continue;
    await catalogPool.query(
      `UPDATE wiki_pages
          SET embedding = $1::vector,
              embedded_hash = $2
        WHERE id = $3`,
      [toPgVectorLiteral(v), r.content_hash, r.id],
    );
  }
  return rows.rows.length;
}

function buildTableEmbedText(r: {
  schema_name: string;
  table_name: string;
  markdown: string;
}): string {
  // Lead with the qualified name so synonyms like "deviations" still rank
  // close to "public.deviations" — name match dominates the vector when the
  // body is short.
  return `${r.schema_name}.${r.table_name}\n\n${r.markdown}`.slice(0, 8000);
}

function buildWikiEmbedText(r: {
  title: string;
  summary: string | null;
  body_md: string;
}): string {
  const parts = [r.title, r.summary ?? "", r.body_md].filter(Boolean);
  return parts.join("\n\n").slice(0, 8000);
}

function md5(s: string): string {
  return createHash("md5").update(s).digest("hex");
}
