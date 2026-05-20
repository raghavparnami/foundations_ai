"""Skills + skill-candidates routes.

Ports:
    src/app/api/skills/route.ts
    src/app/api/skills/[slug]/route.ts
    src/app/api/skill-candidates/route.ts
    src/app/api/skill-candidates/[id]/route.ts
"""
from __future__ import annotations

import re
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from app.audit import audit
from app.catalog.skills import (
    delete_skill,
    get_skill,
    list_skills,
    upsert_skill,
)
from app.db import get_conn

router = APIRouter()

# ─── /api/skills ───────────────────────────────────────────────────────────


class SkillUpsertBody(BaseModel):
    slug: str | None = None
    name: str
    description: str = ""
    triggers: list[str] = Field(default_factory=list)
    body_md: str = ""
    enabled: bool | None = None


_SLUG_RE = re.compile(r"^[a-z][a-z0-9-]{1,60}$")


def _sanitize_slug(raw: str) -> str | None:
    s = re.sub(r"\s+", "-", raw.strip().lower())
    s = re.sub(r"[^a-z0-9-]", "", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s if _SLUG_RE.match(s) else None


@router.get("")
async def list_route() -> dict[str, list[dict[str, Any]]]:
    return {"skills": await list_skills()}


@router.post("")
async def upsert_route(body: SkillUpsertBody) -> dict[str, Any]:
    raw = body.slug or body.name
    slug = _sanitize_slug(raw)
    if not slug:
        raise HTTPException(400, detail="Invalid slug")
    skill = await upsert_skill(
        slug=slug,
        name=(body.name or slug).strip(),
        description=body.description.strip(),
        triggers=[str(t) for t in body.triggers],
        body_md=body.body_md,
        enabled=body.enabled,
    )
    await audit("user", "skill:upsert", slug, {"triggers": len(skill["triggers"] or [])})
    return {"skill": skill}


@router.get("/{slug}")
async def get_one(slug: str) -> dict[str, Any]:
    skill = await get_skill(slug)
    if not skill:
        raise HTTPException(404, detail="not_found")
    return {"skill": skill}


@router.delete("/{slug}")
async def delete_one(slug: str) -> dict[str, bool]:
    await delete_skill(slug)
    await audit("user", "skill:delete", slug)
    return {"ok": True}


# ─── /api/skill-candidates ────────────────────────────────────────────────


candidates_router = APIRouter()


@candidates_router.get("")
async def list_candidates(
    conversation_id: Annotated[str | None, Query()] = None,
) -> dict[str, list[dict[str, Any]]]:
    base = (
        "SELECT id, conversation_id, slug, name, description, triggers, "
        "body_md, created_at FROM skill_candidates WHERE status = 'pending'"
    )
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            if conversation_id:
                await cur.execute(
                    base + " AND conversation_id = %s ORDER BY created_at DESC LIMIT 5",
                    (conversation_id,),
                )
            else:
                await cur.execute(base + " ORDER BY created_at DESC LIMIT 5")
            return {"candidates": await cur.fetchall()}


@candidates_router.post("/{cand_id}")
async def accept_candidate(cand_id: int) -> dict[str, Any]:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT slug, name, description, triggers, body_md
                  FROM skill_candidates
                 WHERE id = %s AND status = 'pending'
                """,
                (cand_id,),
            )
            c = await cur.fetchone()
    if not c:
        raise HTTPException(404, detail="not_found_or_decided")

    triggers = c["triggers"] if isinstance(c["triggers"], list) else []
    skill = await upsert_skill(
        slug=c["slug"],
        name=c["name"],
        description=c["description"],
        triggers=triggers,
        body_md=c["body_md"],
        enabled=True,
    )
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                UPDATE skill_candidates
                   SET status = 'accepted', decided_at = NOW()
                 WHERE id = %s
                """,
                (cand_id,),
            )
    await audit("user", "skill_candidate:accept", c["slug"], {"candidate_id": cand_id})
    return {"ok": True, "skill": skill}


@candidates_router.delete("/{cand_id}")
async def dismiss_candidate(cand_id: int) -> dict[str, bool]:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                UPDATE skill_candidates
                   SET status = 'dismissed', decided_at = NOW()
                 WHERE id = %s AND status = 'pending'
                RETURNING slug
                """,
                (cand_id,),
            )
            row = await cur.fetchone()
    if row:
        await audit("user", "skill_candidate:dismiss", row["slug"], {"candidate_id": cand_id})
    return {"ok": True}
