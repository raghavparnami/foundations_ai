"""Chat message persistence.

Port of src/lib/catalog/messages.ts. Messages are stored verbatim as JSONB
so the AI SDK message shape can round-trip without lossy conversion. The new
frontend produces a slightly different shape than the legacy app, so callers
keep using their own shape — this layer is shape-agnostic.
"""
from __future__ import annotations

import uuid
from typing import Any

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from ..db import get_conn


async def ensure_conversation(
    slug: str,
    initial_title: str | None = None,
    project_slug: str | None = None,
) -> None:
    title = (initial_title or "New conversation")[:120]
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO conversations (slug, title, project_slug)
                     VALUES (%s, %s, %s)
                ON CONFLICT (slug) DO UPDATE
                  SET project_slug = COALESCE(EXCLUDED.project_slug, conversations.project_slug),
                      updated_at = now()
                """,
                (slug, title, project_slug),
            )


async def persist_message(
    conversation_slug: str,
    *,
    message_id: str | None,
    role: str,
    parts: list[dict[str, Any]],
) -> int:
    """Insert or replace a message in the conversation. Returns the assigned ord."""
    stable_id = message_id.strip() if message_id and message_id.strip() else str(uuid.uuid4())
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                INSERT INTO messages (conversation_id, message_id, ord, role, parts)
                     VALUES (
                       %s, %s,
                       COALESCE((SELECT MAX(ord) + 1 FROM messages WHERE conversation_id = %s), 0),
                       %s, %s
                     )
                ON CONFLICT (conversation_id, message_id) DO UPDATE
                  SET parts = EXCLUDED.parts, role = EXCLUDED.role
                RETURNING ord AS next_ord
                """,
                (conversation_slug, stable_id, conversation_slug, role, Jsonb(parts)),
            )
            row = await cur.fetchone()
            await cur.execute(
                "UPDATE conversations SET updated_at = now() WHERE slug = %s",
                (conversation_slug,),
            )
    assert row is not None
    next_ord = int(row["next_ord"])

    # First user message becomes the title if we're still on the default.
    if role == "user" and next_ord == 0:
        text = " ".join(
            p.get("text", "") for p in parts if isinstance(p, dict) and p.get("type") == "text"
        ).strip()[:80]
        if text:
            async with get_conn() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(
                        """
                        UPDATE conversations
                           SET title = %s
                         WHERE slug = %s AND title = 'New conversation'
                        """,
                        (text, conversation_slug),
                    )
    return next_ord


async def load_conversation(conversation_slug: str) -> list[dict[str, Any]]:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT message_id, role, parts
                  FROM messages
                 WHERE conversation_id = %s
                 ORDER BY ord ASC
                """,
                (conversation_slug,),
            )
            rows = await cur.fetchall()
    return [
        {"id": r["message_id"], "role": r["role"], "parts": r["parts"] or []}
        for r in rows
    ]


async def list_conversations(limit: int = 30) -> list[dict[str, Any]]:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT c.slug, c.title, c.project_slug, c.updated_at::text AS updated_at,
                       (SELECT count(*)::int
                          FROM messages m
                         WHERE m.conversation_id = c.slug AND m.role = 'user') AS turn_count
                  FROM conversations c
                 WHERE EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.slug)
                 ORDER BY c.updated_at DESC
                 LIMIT %s
                """,
                (limit,),
            )
            return await cur.fetchall()
