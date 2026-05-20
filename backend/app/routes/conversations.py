"""Conversations + messages routes.

Ports:
    src/app/api/conversations/route.ts
    src/app/api/conversations/[slug]/messages/route.ts (GET only — message
        writes happen inside the chat agent on every turn)
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from app.catalog.messages import list_conversations, load_conversation

router = APIRouter()


@router.get("")
async def list_route() -> dict[str, list[dict[str, Any]]]:
    convs = await list_conversations(30)
    return {
        "conversations": [
            {
                "id": c["slug"],
                "title": c["title"],
                "project_slug": c["project_slug"],
                "last_ts": c["updated_at"],
                "turns": int(c["turn_count"] or 0),
            }
            for c in convs
        ]
    }


@router.get("/{slug}/messages")
async def messages_route(slug: str) -> dict[str, list[dict[str, Any]]]:
    return {"messages": await load_conversation(slug)}
