"""Memory tools for the chat agent.

Port of src/lib/agent/memory-tools.ts. Exposes three tools the agent uses to
curate its own context: `remember` (durable cross-conversation memory),
`recall` (explicit lookup over long-term memories), and `pin_fact`
(conversation-scoped constraint that rides in the system prompt for the rest
of this chat only). Auto-injection of matches lives upstream in the prompt
builder; these are the agent's write/read hooks.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from ..audit import audit
from ..catalog.memories import insert_memory, match_memories, pin_fact as catalog_pin_fact

log = logging.getLogger(__name__)

_SCOPES = ("user", "workspace")
_KINDS = ("preference", "fact", "rule", "glossary", "other")


TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "remember",
            "description": (
                "Save a durable memory the agent should recall on future turns AND future conversations. "
                'Use this when the user states a preference ("always group by line first"), establishes a '
                'business rule ("a run is failed when units_produced < 0.9 * units_target"), or defines a term '
                '("Q1 = Feb–Apr fiscal"). Picks: scope=user for personal preferences, scope=workspace for '
                "shared business rules. Kind=preference|fact|rule|glossary|other."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "scope": {
                        "type": "string",
                        "enum": list(_SCOPES),
                        "description": "user = personal preference; workspace = shared business rule/glossary",
                    },
                    "kind": {"type": "string", "enum": list(_KINDS)},
                    "content": {
                        "type": "string",
                        "minLength": 8,
                        "maxLength": 400,
                        "description": (
                            "One declarative sentence. Will appear verbatim in every relevant system prompt."
                        ),
                    },
                    "importance": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 5,
                        "default": 3,
                        "description": "1=trivia, 3=normal, 5=critical-always-relevant",
                    },
                },
                "required": ["scope", "kind", "content"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "recall",
            "description": (
                "Search the agent's long-term memory for items relevant to a query. Use this when you "
                "suspect a memory exists but didn't appear in the auto-injected set — for example, the user "
                "references something from a past conversation."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "minLength": 3, "maxLength": 200},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 10, "default": 5},
                },
                "required": ["query"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "pin_fact",
            "description": (
                "Record a constraint scoped to THIS conversation only — e.g. \"this analysis focuses on "
                'LINE-B", "we agreed to exclude test runs". Pinned facts ride in the system prompt for the '
                "rest of the conversation but DO NOT leak to other chats. Use this instead of `remember` "
                "when the constraint is per-question, not durable."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "fact": {"type": "string", "minLength": 8, "maxLength": 240},
                },
                "required": ["fact"],
                "additionalProperties": False,
            },
        },
    },
]


async def run_tool(name: str, args: dict[str, Any], *, conversation_id: str) -> str:
    try:
        if name == "remember":
            return _json(await remember(
                scope=args["scope"],
                kind=args["kind"],
                content=args["content"],
                importance=int(args.get("importance", 3)),
                conversation_id=conversation_id,
            ))
        if name == "recall":
            return _json(await recall(
                args["query"],
                int(args.get("limit", 5)),
                conversation_id=conversation_id,
            ))
        if name == "pin_fact":
            return _json(await pin_fact(args["fact"], conversation_id=conversation_id))
        return _json({"error": f"Unknown memory tool: {name}"})
    except Exception as e:  # noqa: BLE001
        log.exception("memory_tools.run_tool failed: %s", name)
        return _json({"error": f"{type(e).__name__}: {e}"})


async def remember(
    *,
    scope: str,
    kind: str,
    content: str,
    importance: int,
    conversation_id: str,
) -> dict[str, Any]:
    m = await insert_memory(
        scope=scope,
        kind=kind,
        content=content,
        importance=importance,
        source="agent",
        conversation_id=conversation_id,
    )
    await audit(
        "agent",
        "memory:remember",
        str(m["id"]),
        {
            "conversationId": conversation_id,
            "scope": scope,
            "kind": kind,
            "importance": importance,
            "bytes": len(content),
        },
    )
    return {"ok": True, "id": m["id"], "scope": scope, "kind": kind, "importance": importance}


async def recall(query: str, limit: int, *, conversation_id: str) -> dict[str, Any]:
    rows = await match_memories(query, limit)
    await audit(
        "agent",
        "memory:recall",
        None,
        {
            "conversationId": conversation_id,
            "query": query[:200],
            "hits": len(rows),
        },
    )
    return {
        "query": query,
        "hits": [
            {
                "id": r["id"],
                "scope": r["scope"],
                "kind": r["kind"],
                "content": r["content"],
                "importance": r["importance"],
            }
            for r in rows
        ],
    }


async def pin_fact(fact: str, *, conversation_id: str) -> dict[str, Any]:
    await catalog_pin_fact(conversation_id, fact)
    await audit(
        "agent",
        "memory:pin",
        None,
        {"conversationId": conversation_id, "fact": fact[:240]},
    )
    return {"ok": True, "conversation_id": conversation_id, "fact": fact}


def _json(value: Any) -> str:
    return json.dumps(value, default=str)
