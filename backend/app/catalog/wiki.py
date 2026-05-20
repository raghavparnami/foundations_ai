"""Wiki data layer — hash-gated upserts + backlinks + agent-tick locks.

Port of src/lib/catalog/wiki.ts. Pages span three corpora (tables / docs / code).
Every write is mirrored to audit_log so the Activity feed shows agent actions.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Literal

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from ..audit import audit
from ..db import get_conn

WikiKind = Literal["tables", "docs", "code"]

_LINK_RE = re.compile(r"\[\[(tables|docs|code)/([a-z0-9][a-z0-9\-_]{1,80})\]\]")
_COLS = (
    "id, kind, slug, title, summary, body_md, source_ref, content_hash, status, "
    "generated_at::text AS generated_at, last_seen_at::text AS last_seen_at, "
    "created_at::text AS created_at, updated_at::text AS updated_at"
)


def page_hash(body_md: str, source_ref: Any) -> str:
    h = hashlib.md5()
    h.update(body_md.encode("utf-8"))
    h.update(b"\n")
    h.update(json.dumps(source_ref if source_ref is not None else None, sort_keys=True).encode("utf-8"))
    return h.hexdigest()


def parse_wiki_links(md: str) -> list[dict[str, str]]:
    return [{"kind": m.group(1), "slug": m.group(2)} for m in _LINK_RE.finditer(md)]


async def upsert_wiki_page(
    actor: str,
    *,
    kind: WikiKind,
    slug: str,
    title: str,
    body_md: str,
    summary: str | None = None,
    source_ref: Any = None,
) -> dict[str, Any]:
    """Returns dict with keys: action ('created'|'updated'|'skipped'), id."""
    h = page_hash(body_md, source_ref)
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                "SELECT id, content_hash FROM wiki_pages WHERE kind = %s AND slug = %s",
                (kind, slug),
            )
            existing = await cur.fetchone()

    if existing:
        if existing["content_hash"] == h:
            async with get_conn() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(
                        "UPDATE wiki_pages SET last_seen_at = NOW() WHERE id = %s",
                        (existing["id"],),
                    )
            await audit(actor, "wiki:page_skip", f"{kind}/{slug}",
                        {"id": existing["id"], "reason": "hash_match"})
            return {"action": "skipped", "id": int(existing["id"])}

        async with get_conn() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    UPDATE wiki_pages
                       SET title = %s, summary = %s, body_md = %s,
                           source_ref = %s, content_hash = %s,
                           status = 'ready', generated_at = NOW(),
                           last_seen_at = NOW(), updated_at = NOW()
                     WHERE id = %s
                    """,
                    (title, summary, body_md, Jsonb(source_ref), h, existing["id"]),
                )
        await _replace_links(int(existing["id"]), body_md)
        await audit(actor, "wiki:page_update", f"{kind}/{slug}",
                    {"id": existing["id"], "bytes": len(body_md)})
        return {"action": "updated", "id": int(existing["id"])}

    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO wiki_pages
                    (kind, slug, title, summary, body_md, source_ref,
                     content_hash, status, generated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, 'ready', NOW())
                RETURNING id
                """,
                (kind, slug, title, summary, body_md, Jsonb(source_ref), h),
            )
            row = await cur.fetchone()
    assert row is not None
    new_id = int(row[0])
    await _replace_links(new_id, body_md)
    await audit(actor, "wiki:page_create", f"{kind}/{slug}",
                {"id": new_id, "bytes": len(body_md)})
    return {"action": "created", "id": new_id}


async def mark_stale_wiki_pages(actor: str, kind: WikiKind, older_than_hours: int = 24) -> int:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                UPDATE wiki_pages
                   SET status = 'stale'
                 WHERE kind = %s AND status = 'ready'
                   AND last_seen_at < NOW() - (%s || ' hours')::interval
                RETURNING id, slug
                """,
                (kind, str(older_than_hours)),
            )
            rows = await cur.fetchall()
    for row in rows:
        await audit(actor, "wiki:page_stale", f"{kind}/{row['slug']}",
                    {"id": row["id"], "hours": older_than_hours})
    return len(rows)


async def begin_agent_tick(kind: WikiKind) -> bool:
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                UPDATE wiki_agent_state
                   SET is_running = TRUE
                 WHERE kind = %s AND is_running = FALSE
                RETURNING kind
                """,
                (kind,),
            )
            row = await cur.fetchone()
    return row is not None


async def end_agent_tick(
    kind: WikiKind, status: str, pages_generated: int, error: str | None = None
) -> None:
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                UPDATE wiki_agent_state
                   SET is_running = FALSE,
                       last_run_at = NOW(),
                       last_status = %s,
                       last_error = %s,
                       pages_generated = pages_generated + %s
                 WHERE kind = %s
                """,
                (status, error, pages_generated, kind),
            )


async def list_wiki_pages(kind: WikiKind | None = None) -> list[dict[str, Any]]:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            if kind:
                await cur.execute(
                    f"SELECT {_COLS} FROM wiki_pages WHERE kind = %s ORDER BY title ASC",
                    (kind,),
                )
            else:
                await cur.execute(
                    f"SELECT {_COLS} FROM wiki_pages ORDER BY kind, title ASC"
                )
            return await cur.fetchall()


async def get_wiki_page(kind: WikiKind, slug: str) -> dict[str, Any] | None:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                f"SELECT {_COLS} FROM wiki_pages WHERE kind = %s AND slug = %s",
                (kind, slug),
            )
            return await cur.fetchone()


async def get_backlinks(to_kind: WikiKind, to_slug: str) -> list[dict[str, Any]]:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                f"""
                SELECT {_COLS.replace('id, ', 'p.id AS id, ')
                              .replace('kind, ', 'p.kind AS kind, ')
                              .replace('slug, ', 'p.slug AS slug, ')
                              .replace('title, ', 'p.title AS title, ')
                              .replace('summary, ', 'p.summary AS summary, ')
                              .replace('body_md, ', 'p.body_md AS body_md, ')
                              .replace('source_ref, ', 'p.source_ref AS source_ref, ')
                              .replace('content_hash, ', 'p.content_hash AS content_hash, ')
                              .replace('status, ', 'p.status AS status, ')
                              .replace('generated_at::text AS generated_at', 'p.generated_at::text AS generated_at')
                              .replace('last_seen_at::text AS last_seen_at', 'p.last_seen_at::text AS last_seen_at')
                              .replace('created_at::text AS created_at', 'p.created_at::text AS created_at')
                              .replace('updated_at::text AS updated_at', 'p.updated_at::text AS updated_at')}
                  FROM wiki_links l
                  JOIN wiki_pages p ON p.id = l.from_page_id
                 WHERE l.to_kind = %s AND l.to_slug = %s
                 ORDER BY p.title
                """,
                (to_kind, to_slug),
            )
            return await cur.fetchall()


async def _replace_links(from_page_id: int, body_md: str) -> None:
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "DELETE FROM wiki_links WHERE from_page_id = %s", (from_page_id,)
            )
            for ref in parse_wiki_links(body_md):
                await cur.execute(
                    """
                    INSERT INTO wiki_links (from_page_id, to_kind, to_slug)
                         VALUES (%s, %s, %s)
                    ON CONFLICT DO NOTHING
                    """,
                    (from_page_id, ref["kind"], ref["slug"]),
                )
