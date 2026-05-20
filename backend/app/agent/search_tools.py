"""Hybrid catalog retrieval tool — `search_catalog`.

Port of src/lib/agent/search-tools.ts. Replaces the unbounded table dump in
the system prompt: the agent calls this first for any entity/table/metric
mentioned in a question. Returns top-K hits ranked by a blend of vector
similarity (pgvector) + lexical full-text. `kind="tables"` skips the wiki
side when the agent only wants SQL targets.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from ..audit import audit
from ..catalog.search import search_catalog, search_tables

log = logging.getLogger(__name__)


TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "search_catalog",
            "description": (
                "Find the relevant tables and wiki pages for the user's question. ALWAYS call this BEFORE "
                "writing SQL or claiming a table doesn't exist — the agent's system prompt no longer dumps "
                "the full table list, so this is your primary discovery tool. Returns the top-K hits ranked "
                "by a hybrid of semantic similarity (vector) and exact name/word match (BM25). Pass "
                '`kind:"tables"` if you specifically want SQL targets and don\'t want wiki noise.'
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "minLength": 2,
                        "description": (
                            "The natural-language question or entity name. Examples: 'deviation rate by "
                            "line', 'orders', 'production runs failing QC'."
                        ),
                    },
                    "k": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 25,
                        "default": 10,
                        "description": "How many hits to return. Default 10; bump up if the user's question is broad.",
                    },
                    "kind": {
                        "type": "string",
                        "enum": ["all", "tables"],
                        "default": "all",
                        "description": "'all' = tables + wiki pages merged; 'tables' = SQL targets only.",
                    },
                },
                "required": ["query"],
                "additionalProperties": False,
            },
        },
    },
]


async def run_tool(name: str, args: dict[str, Any], *, conversation_id: str) -> str:
    try:
        if name == "search_catalog":
            return _json(
                await search_catalog_tool(
                    query=args["query"],
                    k=int(args.get("k", 10)),
                    kind=str(args.get("kind", "all")),
                    conversation_id=conversation_id,
                )
            )
        return _json({"error": f"Unknown search tool: {name}"})
    except Exception as e:  # noqa: BLE001
        log.exception("search_tools.run_tool failed: %s", name)
        return _json({"error": f"{type(e).__name__}: {e}"})


async def search_catalog_tool(
    *,
    query: str,
    k: int,
    kind: str,
    conversation_id: str,
) -> dict[str, Any]:
    await audit(
        "agent",
        "tool:search_catalog",
        None,
        {"conversationId": conversation_id, "query": query, "k": k, "kind": kind},
    )
    hits = (
        await search_tables(query, k)
        if kind == "tables"
        else await search_catalog(query, k)
    )
    if not hits:
        return {
            "ok": True,
            "hits": [],
            "hint": (
                "No tables or wiki pages matched. Try a broader query (single noun) or call "
                "`list_tables` once as a last resort."
            ),
        }
    return {
        "ok": True,
        "hits": [
            {
                "kind": h["kind"],
                "qualified": h["qualified"],
                "title": h["title"],
                "summary": h["summary"],
                "score": _round3(h["score"]),
                "vector_sim": _round3(h["vector_sim"]),
                "lex_rank": _round3(h["lex_rank"]),
            }
            for h in hits
        ],
    }


def _round3(n: float) -> float:
    return round(n * 1000) / 1000


def _json(value: Any) -> str:
    return json.dumps(value, default=str)
