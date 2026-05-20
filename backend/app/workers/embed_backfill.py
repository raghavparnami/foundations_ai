"""Embedding backfill — runs each scheduler tick.

For every table with a doc whose markdown's md5 has drifted from the stored
`content_hash`, re-embed it; same logic for `wiki_pages` keyed on
`embedded_hash` vs `content_hash`. Batched in groups of 64 to amortize API
calls. Becomes a no-op when OPENAI_API_KEY is unset — the catalog then falls
back to lexical (BM25) retrieval until a key is provided.
"""
from __future__ import annotations

import hashlib
import logging
import time
from typing import Any

from psycopg.rows import dict_row

from ..db import get_conn
from .embed import embed_many, embeddings_enabled, to_pgvector_literal

log = logging.getLogger(__name__)

TABLE_BATCH = 64
WIKI_BATCH = 64


async def run_embed_backfill() -> dict[str, int]:
    if not embeddings_enabled():
        return {"tables_embedded": 0, "wiki_embedded": 0, "skipped": 0}
    t0 = time.monotonic()
    tables_embedded = await _embed_dirty_tables()
    wiki_embedded = await _embed_dirty_wiki()
    ms = int((time.monotonic() - t0) * 1000)
    log.info(
        "embed.backfill tables_embedded=%s wiki_embedded=%s ms=%s",
        tables_embedded,
        wiki_embedded,
        ms,
    )
    return {
        "tables_embedded": tables_embedded,
        "wiki_embedded": wiki_embedded,
        "skipped": 0,
    }


async def _embed_dirty_tables() -> int:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT t.id AS table_id, t.schema_name, t.table_name, d.markdown
                  FROM tables t
                  JOIN docs d ON d.table_id = t.id
                  LEFT JOIN embeddings e ON e.table_id = t.id
                 WHERE e.id IS NULL
                    OR e.content_hash IS DISTINCT FROM md5(d.markdown)
                 ORDER BY t.id
                 LIMIT %s
                """,
                (TABLE_BATCH,),
            )
            rows = await cur.fetchall()

    if not rows:
        return 0

    texts = [_build_table_embed_text(r) for r in rows]
    vecs = await embed_many(texts)
    if not vecs:
        return 0

    async with get_conn() as conn:
        async with conn.cursor() as cur:
            for r, v in zip(rows, vecs):
                if not v:
                    continue
                content_hash = _md5(r["markdown"])
                await cur.execute(
                    """
                    INSERT INTO embeddings (table_id, vec, content_hash, updated_at)
                         VALUES (%s, %s::vector, %s, NOW())
                    ON CONFLICT (table_id) DO UPDATE
                       SET vec = EXCLUDED.vec,
                           content_hash = EXCLUDED.content_hash,
                           updated_at = NOW()
                    """,
                    (r["table_id"], to_pgvector_literal(v), content_hash),
                )
    return len(rows)


async def _embed_dirty_wiki() -> int:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT id, title, summary, body_md, content_hash
                  FROM wiki_pages
                 WHERE embedded_hash IS DISTINCT FROM content_hash
                 ORDER BY updated_at DESC
                 LIMIT %s
                """,
                (WIKI_BATCH,),
            )
            rows = await cur.fetchall()

    if not rows:
        return 0

    texts = [_build_wiki_embed_text(r) for r in rows]
    vecs = await embed_many(texts)
    if not vecs:
        return 0

    async with get_conn() as conn:
        async with conn.cursor() as cur:
            for r, v in zip(rows, vecs):
                if not v:
                    continue
                await cur.execute(
                    """
                    UPDATE wiki_pages
                       SET embedding = %s::vector,
                           embedded_hash = %s
                     WHERE id = %s
                    """,
                    (to_pgvector_literal(v), r["content_hash"], r["id"]),
                )
    return len(rows)


def _build_table_embed_text(r: dict[str, Any]) -> str:
    # Lead with the qualified name so synonyms still rank close to the canonical
    # name — name match dominates the vector when the body is short.
    head = f"{r['schema_name']}.{r['table_name']}"
    return f"{head}\n\n{r['markdown']}"[:8000]


def _build_wiki_embed_text(r: dict[str, Any]) -> str:
    parts = [r.get("title") or "", r.get("summary") or "", r.get("body_md") or ""]
    return "\n\n".join(p for p in parts if p)[:8000]


def _md5(s: str) -> str:
    return hashlib.md5(s.encode("utf-8")).hexdigest()
