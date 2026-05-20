"""Skills (analytical playbooks).

Port of src/lib/catalog/skills.ts. A skill is a markdown body the agent loads
into its system prompt when one of its triggers matches the user's question.
"""
from __future__ import annotations

from typing import Any

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from ..db import get_conn


async def list_skills() -> list[dict[str, Any]]:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT id, slug, name, description, triggers, body_md, enabled,
                       created_at, updated_at
                  FROM skills ORDER BY name
                """
            )
            return await cur.fetchall()


async def get_skill(slug: str) -> dict[str, Any] | None:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT id, slug, name, description, triggers, body_md, enabled,
                       created_at, updated_at
                  FROM skills WHERE slug = %s
                """,
                (slug,),
            )
            return await cur.fetchone()


async def upsert_skill(
    *,
    slug: str,
    name: str,
    description: str,
    triggers: list[str],
    body_md: str,
    enabled: bool | None = None,
) -> dict[str, Any]:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                INSERT INTO skills (slug, name, description, triggers, body_md, enabled, updated_at)
                     VALUES (%s, %s, %s, %s, %s, COALESCE(%s, TRUE), now())
                ON CONFLICT (slug) DO UPDATE
                  SET name = EXCLUDED.name,
                      description = EXCLUDED.description,
                      triggers = EXCLUDED.triggers,
                      body_md = EXCLUDED.body_md,
                      enabled = COALESCE(EXCLUDED.enabled, skills.enabled),
                      updated_at = now()
                RETURNING id, slug, name, description, triggers, body_md, enabled,
                          created_at, updated_at
                """,
                (slug, name, description, Jsonb(triggers), body_md, enabled),
            )
            row = await cur.fetchone()
    assert row is not None
    return row


async def delete_skill(slug: str) -> None:
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute("DELETE FROM skills WHERE slug = %s", (slug,))


async def match_skills(question: str, limit: int = 3) -> list[dict[str, Any]]:
    """Score by simple case-insensitive trigger substring match."""
    skills = await list_skills()
    lower = question.lower()
    scored: list[tuple[int, dict[str, Any]]] = []
    for s in skills:
        if not s["enabled"]:
            continue
        hits = sum(
            1
            for t in (s.get("triggers") or [])
            if isinstance(t, str) and t.lower() in lower
        )
        if hits > 0:
            scored.append((hits, s))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [s for _, s in scored[:limit]]
