"""Memory CRUD routes.

Ports:
    src/app/api/memories/route.ts
    src/app/api/memories/[id]/route.ts
"""
from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.audit import audit
from app.catalog.memories import (
    delete_memory,
    insert_memory,
    list_memories,
    update_memory,
)

router = APIRouter()

Scope = Literal["user", "workspace"]
Kind = Literal["preference", "fact", "rule", "glossary", "other"]


class MemoryCreate(BaseModel):
    scope: Scope = "user"
    kind: Kind = "other"
    content: str
    importance: Annotated[int, Field(ge=1, le=5)] = 3


class MemoryPatch(BaseModel):
    content: str | None = None
    importance: Annotated[int | None, Field(ge=1, le=5)] = None
    scope: Scope | None = None
    kind: Kind | None = None
    enabled: bool | None = None
    status: str | None = None


@router.get("")
async def list_route(
    scope: Annotated[Scope | None, Query()] = None,
) -> dict[str, list[dict[str, Any]]]:
    memories = await list_memories(scope=scope, limit=200)
    return {"memories": memories}


@router.post("")
async def create_route(body: MemoryCreate) -> dict[str, Any]:
    if not body.content.strip():
        raise HTTPException(400, detail="content is required")
    m = await insert_memory(
        scope=body.scope,
        kind=body.kind,
        content=body.content,
        importance=body.importance,
        source="user",
    )
    await audit(
        "user", "memory:create", str(m["id"]),
        {"scope": body.scope, "kind": body.kind, "importance": body.importance},
    )
    return {"memory": m}


@router.patch("/{memory_id}")
async def patch_route(memory_id: int, body: MemoryPatch) -> dict[str, Any]:
    patch = body.model_dump(exclude_none=True)
    m = await update_memory(memory_id, patch)
    if not m:
        raise HTTPException(404, detail="not_found")
    await audit("user", "memory:update", str(m["id"]), patch)
    return {"memory": m}


@router.delete("/{memory_id}")
async def delete_route(memory_id: int) -> dict[str, bool]:
    await delete_memory(memory_id)
    await audit("user", "memory:delete", str(memory_id))
    return {"ok": True}
