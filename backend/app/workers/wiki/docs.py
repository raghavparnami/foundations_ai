"""Docs-wiki agent.

Picks up never-indexed documents (or those whose content_hash changed since
the last indexing pass), chunks them, asks the doc-writer LLM for a structured
summary, and upserts a ``wiki_pages`` row with kind='docs'. Hash-gated end to
end via ``upsert_wiki_page`` + ``documents.last_indexed_hash``.
"""
from __future__ import annotations

import logging
import re
import time
from typing import Any

from psycopg.rows import dict_row

from ...audit import audit
from ...catalog.wiki import upsert_wiki_page
from ...db import get_conn
from ...llm import async_client, chat_model_id
from ..rules import with_rules

log = logging.getLogger(__name__)

ACTOR = "wiki-agent:docs"
CHUNK_SIZE = 1500
CHUNK_OVERLAP = 200

SYSTEM_PROMPT = """You are Loom's documentation summarizer. Given the raw
text of a single document, write a concise wiki page with this exact structure:

  ## What it is
  One paragraph: what this document covers and who it's for.

  ## Key points
  3 to 8 bullet points. Quote a phrase verbatim if it captures a definition,
  rule, or threshold the team should remember. Bold any KPI or metric name.

  ## When to reference
  2 or 3 bullets describing when an analyst should pull this doc into a
  question (e.g. "any question about Q3 quality targets").

  ## Related (optional)
  Bullet list of [[tables/<slug>]] or [[code/<slug>]] cross-references IF
  the document explicitly mentions table names or repos that look like Loom
  identifiers. Skip the section entirely if no obvious matches.

Write nothing outside these sections. No preamble."""


async def run_docs_wiki_agent() -> dict[str, int]:
    """Index up to 10 pending/changed documents per tick."""
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT id, display_name, body_text, content_hash, mime, size_bytes::text
                  FROM documents
                 WHERE status = 'pending'
                    OR (status = 'indexed'
                        AND content_hash IS DISTINCT FROM last_indexed_hash)
                 ORDER BY uploaded_at ASC
                 LIMIT 10
                """,
            )
            pending = await cur.fetchall()

    generated = 0
    for doc in pending:
        try:
            await _index_one_doc(doc)
            generated += 1
        except Exception as e:  # noqa: BLE001
            async with get_conn() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(
                        "UPDATE documents SET status = 'failed' WHERE id = %s",
                        (doc["id"],),
                    )
            await audit(ACTOR, "wiki:doc_index_failed", str(doc["id"]), {"err": str(e)})
            log.exception("docs.index_failed id=%s", doc["id"])
    return {"generated": generated}


async def _index_one_doc(doc: dict[str, Any]) -> None:
    doc_id = int(doc["id"])
    display_name: str = doc["display_name"]
    body_text: str = doc["body_text"] or ""
    content_hash: str = doc["content_hash"]

    # 1. Chunk + (re)write chunks.
    chunks = _chunk_text(body_text, CHUNK_SIZE, CHUNK_OVERLAP)
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute("DELETE FROM doc_chunks WHERE document_id = %s", (doc_id,))
            for i, chunk in enumerate(chunks):
                await cur.execute(
                    "INSERT INTO doc_chunks (document_id, ord, text) VALUES (%s, %s, %s)",
                    (doc_id, i, chunk),
                )

    # 2. Ask the doc-writer for a structured summary.
    sample = _compose_sample(chunks)
    client = async_client()
    resp = await client.chat.completions.create(
        model=chat_model_id(),
        messages=[
            {"role": "system", "content": with_rules(SYSTEM_PROMPT, "wiki")},
            {"role": "user", "content": f"# Document: {display_name}\n\n{sample}"},
        ],
    )
    text = (resp.choices[0].message.content or "").strip() if resp.choices else ""

    # 3. Upsert the wiki page.
    slug = _slugify(display_name)
    summary = _first_line_of(text) or f"Summary of {display_name}"
    await upsert_wiki_page(
        ACTOR,
        kind="docs",
        slug=slug,
        title=display_name,
        summary=summary,
        body_md=text,
        source_ref={"document_id": doc_id, "content_hash": content_hash},
    )

    # 4. Mark document indexed; stamp last_indexed_hash so unchanged docs skip
    #    the LLM next tick.
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                UPDATE documents
                   SET status = 'indexed',
                       indexed_at = NOW(),
                       last_indexed_hash = %s
                 WHERE id = %s
                """,
                (content_hash, doc_id),
            )


def _chunk_text(text: str, size: int, overlap: int) -> list[str]:
    if len(text) <= size:
        return [text] if text else []
    out: list[str] = []
    i = 0
    n = len(text)
    while i < n:
        end = min(i + size, n)
        out.append(text[i:end])
        if end == n:
            break
        i = end - overlap
    return out


def _compose_sample(chunks: list[str]) -> str:
    if len(chunks) <= 4:
        return "\n\n---\n\n".join(chunks)
    head = chunks[:3]
    tail = chunks[-1:]
    return "\n\n---\n\n".join([*head, "…", *tail])


_SLUG_SPACES = re.compile(r"\s+")
_SLUG_DROP = re.compile(r"[^a-z0-9-]")
_SLUG_DASHES = re.compile(r"-+")
_SLUG_EDGES = re.compile(r"^-|-$")
_EXT_RE = re.compile(r"\.[^.]+$")


def _slugify(name: str) -> str:
    base = _EXT_RE.sub("", name)
    s = base.lower()
    s = _SLUG_SPACES.sub("-", s)
    s = _SLUG_DROP.sub("", s)
    s = _SLUG_DASHES.sub("-", s)
    s = _SLUG_EDGES.sub("", s)
    return s or f"doc-{int(time.time() * 1000)}"


def _first_line_of(md: str) -> str | None:
    for line in md.split("\n"):
        t = line.strip()
        if not t or t.startswith("#"):
            continue
        return t[:200]
    return None
