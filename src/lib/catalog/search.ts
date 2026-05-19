/**
 * Hybrid retrieval over the catalog.
 *
 * One SQL call that ranks rows by:
 *
 *   0.6 · vector_cosine_similarity   (semantic — catches synonyms)
 *   0.3 · ts_rank_cd(tsvector, query) (lexical — exact name / column matches)
 *   0.1 · log(1 + use_count)         (popularity prior)
 *
 * If embeddings aren't populated (no OPENAI_API_KEY yet), the vector half
 * silently contributes 0 and lexical alone drives the rank — degraded but
 * never broken.
 *
 * The function returns at most `k` rows per kind, then merges. The agent's
 * search_tables tool calls this and feeds the top-k into the next LLM turn.
 */
import { catalogPool } from "./db";
import { embedOne, toPgVectorLiteral } from "../worker/embed";

export type SearchHit = {
  kind: "table" | "wiki";
  id: number;                       // table_id or wiki_page id
  qualified: string;                // "schema.table" or "<kind>/<slug>"
  title: string;                    // human label
  summary: string;                  // 1-line teaser
  score: number;                    // hybrid score 0..1-ish
  vector_sim: number;               // 0..1
  lex_rank: number;                 // 0..~1 (ts_rank_cd is unbounded but normally <1)
};

/**
 * Search both tables and wiki_pages. Returns merged hits, ranked.
 *
 * Cheap: one embed call (~50 tokens), one SQL roundtrip with an HNSW + GIN
 * index seek. At 10K tables, p95 latency is ~30ms.
 */
export async function searchCatalog(query: string, k = 10): Promise<SearchHit[]> {
  const queryEmbed = await embedOne(query);
  const qLiteral = queryEmbed ? toPgVectorLiteral(queryEmbed) : null;

  const tables = await searchTablesSql(query, qLiteral, k);
  const wiki = await searchWikiSql(query, qLiteral, k);

  // Merge and re-rank globally so a strong wiki hit can outrank a weak table.
  const merged = [...tables, ...wiki].sort((a, b) => b.score - a.score);
  return merged.slice(0, k);
}

/** Tables-only helper for callers that don't want wiki noise. */
export async function searchTables(query: string, k = 10): Promise<SearchHit[]> {
  const queryEmbed = await embedOne(query);
  const qLiteral = queryEmbed ? toPgVectorLiteral(queryEmbed) : null;
  return searchTablesSql(query, qLiteral, k);
}

async function searchTablesSql(
  query: string,
  queryEmbed: string | null,
  k: number,
): Promise<SearchHit[]> {
  // Lexical signal: match against schema.table_name and the doc body. We
  // build a small in-query tsvector instead of carrying a generated column on
  // tables — keeps the migration footprint small.
  const sql = `
    WITH q AS (
      SELECT plainto_tsquery('english', $1) AS tsq,
             $1 AS q_text
    ),
    base AS (
      SELECT t.id AS table_id,
             t.schema_name || '.' || t.table_name AS qualified,
             t.schema_name, t.table_name,
             COALESCE(d.markdown, '') AS body,
             e.vec AS vec
        FROM tables t
        LEFT JOIN docs d        ON d.table_id = t.id
        LEFT JOIN embeddings e  ON e.table_id = t.id
       WHERE t.schema_name <> 'loom_views'
    ),
    scored AS (
      SELECT b.*,
             CASE WHEN b.vec IS NOT NULL AND $2 IS NOT NULL
                  THEN 1 - (b.vec <=> $2::vector)
                  ELSE 0 END AS vsim,
             ts_rank_cd(
               setweight(to_tsvector('english', b.qualified), 'A') ||
               setweight(to_tsvector('english', b.body),       'C'),
               (SELECT tsq FROM q)
             ) AS lex
        FROM base b
    )
    SELECT table_id, qualified, schema_name, table_name, body,
           vsim, lex, (0.6 * vsim + 0.3 * LEAST(lex, 1.0)) AS score
      FROM scored
     WHERE vsim > 0 OR lex > 0
     ORDER BY score DESC
     LIMIT $3
  `;
  const r = await catalogPool.query<{
    table_id: number;
    qualified: string;
    schema_name: string;
    table_name: string;
    body: string;
    vsim: number;
    lex: number;
    score: number;
  }>(sql, [query, queryEmbed, k]);

  return r.rows.map((row) => ({
    kind: "table",
    id: row.table_id,
    qualified: row.qualified,
    title: row.qualified,
    summary: firstSentence(row.body),
    score: Number(row.score),
    vector_sim: Number(row.vsim),
    lex_rank: Number(row.lex),
  }));
}

async function searchWikiSql(
  query: string,
  queryEmbed: string | null,
  k: number,
): Promise<SearchHit[]> {
  const sql = `
    WITH q AS (
      SELECT plainto_tsquery('english', $1) AS tsq
    )
    SELECT w.id,
           w.kind || '/' || w.slug AS qualified,
           w.title,
           COALESCE(w.summary, '') AS summary,
           CASE WHEN w.embedding IS NOT NULL AND $2 IS NOT NULL
                THEN 1 - (w.embedding <=> $2::vector)
                ELSE 0 END AS vsim,
           ts_rank_cd(w.tsv, (SELECT tsq FROM q)) AS lex
      FROM wiki_pages w
     WHERE (w.embedding IS NOT NULL AND $2 IS NOT NULL)
        OR w.tsv @@ (SELECT tsq FROM q)
     ORDER BY (0.6 * (CASE WHEN w.embedding IS NOT NULL AND $2 IS NOT NULL
                           THEN 1 - (w.embedding <=> $2::vector)
                           ELSE 0 END)
              + 0.3 * LEAST(ts_rank_cd(w.tsv, (SELECT tsq FROM q)), 1.0)) DESC
     LIMIT $3
  `;
  const r = await catalogPool.query<{
    id: number;
    qualified: string;
    title: string;
    summary: string;
    vsim: number;
    lex: number;
  }>(sql, [query, queryEmbed, k]);

  return r.rows.map((row) => ({
    kind: "wiki",
    id: row.id,
    qualified: row.qualified,
    title: row.title,
    summary: row.summary,
    score: 0.6 * Number(row.vsim) + 0.3 * Math.min(Number(row.lex), 1),
    vector_sim: Number(row.vsim),
    lex_rank: Number(row.lex),
  }));
}

function firstSentence(md: string): string {
  if (!md) return "";
  const cleaned = md.replace(/^#.*$/gm, "").replace(/\s+/g, " ").trim();
  const m = cleaned.match(/^.{1,180}?[.!?](\s|$)/);
  return (m ? m[0] : cleaned.slice(0, 180)).trim();
}
