"""Agent memory store — short-term TTL + long-term curated.

Port of src/lib/catalog/memories.ts. Short memories auto-save per turn with
a 7-day TTL; long memories are user-curated and never expire. Conversation
snapshots (running summary + pinned facts) live on the conversations row,
separate from this table.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from ..db import get_conn

SHORT_TERM_TTL_DAYS = 7

_RETURNING = (
    "id, scope, kind, content, importance, source, tier, expires_at::text, "
    "conversation_id, status, enabled, created_at::text, updated_at::text, "
    "last_used_at::text, use_count"
)


async def insert_memory(
    *,
    scope: str,
    kind: str,
    content: str,
    importance: int | None = None,
    source: str | None = None,
    tier: str | None = None,
    expires_at: str | None = None,
    conversation_id: str | None = None,
) -> dict[str, Any]:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                f"""
                INSERT INTO memories (scope, kind, content, importance, source, tier,
                                       expires_at, conversation_id)
                     VALUES (%s, %s, %s, COALESCE(%s, 3), COALESCE(%s, 'agent'),
                             COALESCE(%s, 'long'), %s, %s)
                RETURNING {_RETURNING}
                """,
                (
                    scope, kind, content.strip(), importance, source, tier,
                    expires_at, conversation_id,
                ),
            )
            row = await cur.fetchone()
    assert row is not None
    return row


async def auto_save_short_term(
    *, conversation_id: str, user_question: str, approach_summary: str
) -> dict[str, Any] | None:
    content = (
        f"Q: {user_question.strip()[:280]}\n"
        f"{approach_summary.strip()[:600]}"
    )
    if len(content) < 20:
        return None
    expires = (datetime.now(timezone.utc) + timedelta(days=SHORT_TERM_TTL_DAYS)).isoformat()
    return await insert_memory(
        scope="user",
        kind="other",
        content=content,
        importance=2,
        source="auto",
        tier="short",
        expires_at=expires,
        conversation_id=conversation_id,
    )


async def prune_expired_memories() -> int:
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                WITH d AS (
                  DELETE FROM memories
                   WHERE tier = 'short' AND expires_at IS NOT NULL AND expires_at < NOW()
                   RETURNING 1
                )
                SELECT count(*)::int FROM d
                """
            )
            row = await cur.fetchone()
    return int(row[0]) if row else 0


async def list_memories(
    *,
    scope: str | None = None,
    include_archived: bool = False,
    limit: int = 100,
) -> list[dict[str, Any]]:
    where: list[str] = []
    args: list[Any] = []
    if not include_archived:
        where.append("status = 'active' AND enabled = TRUE")
    if scope:
        args.append(scope)
        where.append(f"scope = %s")
    capped = min(200, limit)
    sql = (
        "SELECT id, scope, kind, content, importance, source, conversation_id, "
        "status, enabled, created_at::text, updated_at::text, last_used_at::text, "
        "use_count FROM memories "
        + (f"WHERE {' AND '.join(where)} " if where else "")
        + "ORDER BY importance DESC, COALESCE(last_used_at, created_at) DESC "
        f"LIMIT {capped}"
    )
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(sql, args)
            return await cur.fetchall()


async def match_memories(query: str, k: int = 6) -> list[dict[str, Any]]:
    """Hybrid scoring: substring hit + per-word matches + importance + recency."""
    all_mem = await list_memories(limit=200)
    if not all_mem:
        return []
    q = query.strip().lower()
    words = [w for w in re.split(r"\W+", q) if len(w) >= 3]

    now = datetime.now(timezone.utc)
    scored: list[tuple[float, dict[str, Any]]] = []
    for m in all_mem:
        text = m["content"].lower()
        score: float = 0
        if q in text:
            score += 10
        for w in words:
            if w in text:
                score += 2
        score += m.get("importance", 0)
        if m.get("last_used_at"):
            try:
                age_h = (now - datetime.fromisoformat(m["last_used_at"])).total_seconds() / 3600
                score += max(0.0, 2 - age_h / 24)
            except (ValueError, TypeError):
                pass
        if score > 3:
            scored.append((score, m))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [m for _, m in scored[:k]]


async def touch_memories(ids: Iterable[int]) -> None:
    id_list = list(ids)
    if not id_list:
        return
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                UPDATE memories
                   SET last_used_at = NOW(), use_count = use_count + 1
                 WHERE id = ANY(%s::int[])
                """,
                (id_list,),
            )


_MEMORY_PATCH_FIELDS = {"content", "importance", "scope", "kind", "enabled", "status"}


async def update_memory(memory_id: int, patch: dict[str, Any]) -> dict[str, Any] | None:
    sets: list[str] = []
    args: list[Any] = []
    for k, v in patch.items():
        if k not in _MEMORY_PATCH_FIELDS or v is None:
            continue
        args.append(v)
        sets.append(f"{k} = %s")
    if not sets:
        return None
    args.append(memory_id)
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                f"""
                UPDATE memories SET {", ".join(sets)}, updated_at = NOW()
                 WHERE id = %s
                RETURNING id, scope, kind, content, importance, source, conversation_id,
                          status, enabled, created_at::text, updated_at::text,
                          last_used_at::text, use_count
                """,
                args,
            )
            return await cur.fetchone()


async def delete_memory(memory_id: int) -> None:
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute("DELETE FROM memories WHERE id = %s", (memory_id,))


# ─── Conversation snapshot (per-chat running summary + pinned facts) ────


async def get_conversation_snapshot(slug: str) -> dict[str, Any] | None:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT summary_md,
                       pinned_facts,
                       last_summarized_at::text AS last_summarized_at,
                       summarized_turn_count
                  FROM conversations WHERE slug = %s
                """,
                (slug,),
            )
            row = await cur.fetchone()
    if not row:
        return None
    pf = row.get("pinned_facts")
    return {
        "summary_md": row["summary_md"],
        "pinned_facts": pf if isinstance(pf, list) else [],
        "last_summarized_at": row["last_summarized_at"],
        "summarized_turn_count": row.get("summarized_turn_count") or 0,
    }


async def pin_fact(slug: str, fact: str) -> None:
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                UPDATE conversations
                   SET pinned_facts = pinned_facts || %s::jsonb,
                       updated_at = NOW()
                 WHERE slug = %s
                """,
                (Jsonb([fact.strip()]), slug),
            )


async def set_conversation_summary(slug: str, summary_md: str, turn_count: int) -> None:
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                UPDATE conversations
                   SET summary_md = %s,
                       last_summarized_at = NOW(),
                       summarized_turn_count = %s,
                       updated_at = NOW()
                 WHERE slug = %s
                """,
                (summary_md, turn_count, slug),
            )
