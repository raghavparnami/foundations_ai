"""Joins-graph tool for the chat agent.

Port of src/lib/agent/join-tools.ts. `resolve_join(from_table, to_table?)`:
when both are given, returns the highest-confidence join between them
ready to paste into an ON clause; with only `from_table`, returns every
known join from that anchor ranked by confidence.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from psycopg.rows import dict_row

from ..audit import audit
from ..catalog.joins import list_joins_for_table, resolve_join_pair
from ..db import get_conn

log = logging.getLogger(__name__)


TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "resolve_join",
            "description": (
                "Look up the agreed join clause between two tables. Pass `from_table` and `to_table` as "
                "qualified `schema.name` (e.g. 'public.deviations'). Returns the join columns + confidence "
                "+ provenance ('fk', 'observed', 'name_match'). If `to_table` is omitted, returns ALL known "
                "joins from `from_table` ranked by confidence — useful when you're exploring what's "
                "reachable from one anchor."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "from_table": {
                        "type": "string",
                        "description": "Qualified table name, e.g. 'public.deviations'.",
                    },
                    "to_table": {
                        "type": "string",
                        "description": "Optional. If set, returns the single best join between the pair.",
                    },
                },
                "required": ["from_table"],
                "additionalProperties": False,
            },
        },
    },
]


async def run_tool(name: str, args: dict[str, Any], *, conversation_id: str) -> str:
    try:
        if name == "resolve_join":
            return _json(
                await resolve_join(
                    from_table=args["from_table"],
                    to_table=args.get("to_table"),
                    conversation_id=conversation_id,
                )
            )
        return _json({"error": f"Unknown join tool: {name}"})
    except Exception as e:  # noqa: BLE001
        log.exception("join_tools.run_tool failed: %s", name)
        return _json({"error": f"{type(e).__name__}: {e}"})


async def resolve_join(
    *,
    from_table: str,
    to_table: str | None,
    conversation_id: str,
) -> dict[str, Any]:
    await audit(
        "agent",
        "tool:resolve_join",
        from_table,
        {"conversationId": conversation_id, "to": to_table},
    )

    if to_table:
        j = await resolve_join_pair(from_table, to_table)
        if not j:
            return {
                "ok": False,
                "error": (
                    f"No known join between {from_table} and {to_table}. They may share a column "
                    "name — try search_wiki, or write the SQL based on the columns each table exposes."
                ),
            }
        from_cols = list(j.get("from_columns") or [])
        to_cols = list(j.get("to_columns") or [])
        return {
            "ok": True,
            "from": j["from_qualified"],
            "to": j["to_qualified"],
            "from_columns": from_cols,
            "to_columns": to_cols,
            "source": j["source"],
            "confidence": float(j["confidence"]),
            "observed_count": j["observed_count"],
            "on_clause": render_on_clause(j["from_qualified"], from_cols, j["to_qualified"], to_cols),
        }

    # No to_table — list every known join from `from_table`.
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT t.id
                  FROM tables t
                 WHERE t.schema_name || '.' || t.table_name = %s
                 LIMIT 1
                """,
                (from_table,),
            )
            row = await cur.fetchone()
    if not row:
        return {"ok": False, "error": f"No table named {from_table} in the catalog."}
    joins = await list_joins_for_table(int(row["id"]))
    return {
        "ok": True,
        "from": from_table,
        "joins": [
            {
                "to": j["to_qualified"],
                "from_columns": list(j.get("from_columns") or []),
                "to_columns": list(j.get("to_columns") or []),
                "source": j["source"],
                "confidence": float(j["confidence"]),
                "on_clause": render_on_clause(
                    from_table,
                    list(j.get("from_columns") or []),
                    j["to_qualified"],
                    list(j.get("to_columns") or []),
                ),
            }
            for j in joins
        ],
    }


def render_on_clause(
    from_table: str, from_cols: list[str], to_table: str, to_cols: list[str]
) -> str:
    if len(from_cols) == 1 and len(to_cols) == 1:
        return f"JOIN {to_table} ON {from_table}.{from_cols[0]} = {to_table}.{to_cols[0]}"
    pairs: list[str] = []
    fallback = to_cols[0] if to_cols else ""
    for i, c in enumerate(from_cols):
        rhs = to_cols[i] if i < len(to_cols) else fallback
        pairs.append(f"{from_table}.{c} = {to_table}.{rhs}")
    return f"JOIN {to_table} ON {' AND '.join(pairs)}"


def _json(value: Any) -> str:
    return json.dumps(value, default=str)
