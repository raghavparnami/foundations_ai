"""Hybrid retrieval over the catalog.

Port of src/lib/catalog/search.ts. One ranking SQL per corpus blends:
    0.6 · vector cosine similarity (semantic; via pgvector)
    0.3 · ts_rank_cd lexical match (Postgres full-text)
    0.1 · popularity prior (handled at insert time elsewhere)

If embeddings aren't populated (no OpenAI key), the vector half scores 0 and
lexical alone drives the rank — degraded but never broken.
"""
from __future__ import annotations

import re
from typing import Any

from psycopg.rows import dict_row

from ..db import get_conn
from ..workers.embed import embed_one, to_pgvector_literal


async def search_catalog(query: str, k: int = 10) -> list[dict[str, Any]]:
    """Search both tables and wiki_pages, then merge by score."""
    q_embed = await embed_one(query)
    q_lit = to_pgvector_literal(q_embed) if q_embed else None
    tables = await _search_tables_sql(query, q_lit, k)
    wiki = await _search_wiki_sql(query, q_lit, k)
    merged = sorted([*tables, *wiki], key=lambda r: r["score"], reverse=True)
    return merged[:k]


async def search_tables(query: str, k: int = 10) -> list[dict[str, Any]]:
    q_embed = await embed_one(query)
    q_lit = to_pgvector_literal(q_embed) if q_embed else None
    return await _search_tables_sql(query, q_lit, k)


_TABLES_SQL = """
WITH q AS (
  SELECT plainto_tsquery('english', %s) AS tsq, %s AS q_text
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
         CASE WHEN b.vec IS NOT NULL AND %s IS NOT NULL
              THEN 1 - (b.vec <=> %s::vector)
              ELSE 0 END AS vsim,
         ts_rank_cd(
           setweight(to_tsvector('english', b.qualified), 'A') ||
           setweight(to_tsvector('english', b.body),       'C'),
           (SELECT tsq FROM q)
         ) AS lex
    FROM base b
)
SELECT table_id, qualified, schema_name, table_name, body,
       vsim::float8, lex::float8,
       (0.6 * vsim + 0.3 * LEAST(lex, 1.0))::float8 AS score
  FROM scored
 WHERE vsim > 0 OR lex > 0
 ORDER BY score DESC
 LIMIT %s
"""


async def _search_tables_sql(
    query: str, q_embed: str | None, k: int
) -> list[dict[str, Any]]:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(_TABLES_SQL, (query, query, q_embed, q_embed, k))
            rows = await cur.fetchall()
    return [
        {
            "kind": "table",
            "id": int(r["table_id"]),
            "qualified": r["qualified"],
            "title": r["qualified"],
            "summary": _first_sentence(r["body"] or ""),
            "score": float(r["score"]),
            "vector_sim": float(r["vsim"]),
            "lex_rank": float(r["lex"]),
        }
        for r in rows
    ]


_WIKI_SQL = """
WITH q AS (SELECT plainto_tsquery('english', %s) AS tsq)
SELECT w.id,
       w.kind || '/' || w.slug AS qualified,
       w.title,
       COALESCE(w.summary, '') AS summary,
       CASE WHEN w.embedding IS NOT NULL AND %s IS NOT NULL
            THEN 1 - (w.embedding <=> %s::vector)
            ELSE 0 END AS vsim,
       ts_rank_cd(w.tsv, (SELECT tsq FROM q)) AS lex
  FROM wiki_pages w
 WHERE (w.embedding IS NOT NULL AND %s IS NOT NULL)
    OR w.tsv @@ (SELECT tsq FROM q)
 ORDER BY (0.6 * (CASE WHEN w.embedding IS NOT NULL AND %s IS NOT NULL
                       THEN 1 - (w.embedding <=> %s::vector)
                       ELSE 0 END)
          + 0.3 * LEAST(ts_rank_cd(w.tsv, (SELECT tsq FROM q)), 1.0)) DESC
 LIMIT %s
"""


async def _search_wiki_sql(
    query: str, q_embed: str | None, k: int
) -> list[dict[str, Any]]:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                _WIKI_SQL, (query, q_embed, q_embed, q_embed, q_embed, q_embed, k)
            )
            rows = await cur.fetchall()
    out: list[dict[str, Any]] = []
    for r in rows:
        vsim = float(r["vsim"])
        lex = float(r["lex"])
        out.append({
            "kind": "wiki",
            "id": int(r["id"]),
            "qualified": r["qualified"],
            "title": r["title"],
            "summary": r["summary"],
            "score": 0.6 * vsim + 0.3 * min(lex, 1.0),
            "vector_sim": vsim,
            "lex_rank": lex,
        })
    return out


_HEADING_RE = re.compile(r"^#.*$", re.MULTILINE)
_SENT_RE = re.compile(r"^.{1,180}?[.!?](\s|$)")


def _first_sentence(md: str) -> str:
    if not md:
        return ""
    cleaned = re.sub(r"\s+", " ", _HEADING_RE.sub("", md)).strip()
    m = _SENT_RE.match(cleaned)
    return (m.group(0) if m else cleaned[:180]).strip()
