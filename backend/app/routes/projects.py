"""Projects routes.

Port of src/app/api/projects/route.ts + src/app/api/projects/[slug]/route.ts.
"""
from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.audit import audit
from app.catalog.projects import (
    delete_project,
    get_project,
    list_projects,
    upsert_project,
)

router = APIRouter()

_SLUG_RE = re.compile(r"^[a-z][a-z0-9-]{1,60}$")


def _sanitize_slug(raw: str) -> str | None:
    s = re.sub(r"\s+", "-", raw.strip().lower())
    s = re.sub(r"[^a-z0-9-]", "", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s if _SLUG_RE.match(s) else None


class ProjectBody(BaseModel):
    slug: str | None = None
    name: str
    description: str | None = None
    table_ids: list[int] = Field(default_factory=list)


@router.get("")
async def list_route() -> dict[str, list[dict[str, Any]]]:
    return {"projects": await list_projects()}


@router.post("")
async def upsert_route(body: ProjectBody) -> dict[str, Any]:
    name = body.name.strip()
    if not name:
        raise HTTPException(400, detail="name is required")
    slug = _sanitize_slug(body.slug or name)
    if not slug:
        raise HTTPException(400, detail="invalid slug")
    project = await upsert_project(
        slug=slug,
        name=name,
        description=(body.description or "").strip() or None,
        table_ids=[int(t) for t in body.table_ids],
    )
    await audit("user", "project:upsert", slug, {"tables": len(project["table_ids"])})
    return {"project": project}


@router.get("/{slug}")
async def get_route(slug: str) -> dict[str, Any]:
    p = await get_project(slug)
    if not p:
        raise HTTPException(404, detail="not_found")
    return {"project": p}


@router.delete("/{slug}")
async def delete_route(slug: str) -> dict[str, bool]:
    await delete_project(slug)
    await audit("user", "project:delete", slug)
    return {"ok": True}
