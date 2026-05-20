"""The four v0.5 read tools the chat agent can call.

OpenAI-compatible tool definitions + a dispatcher. The agent loop invokes
`run_tool(name, args)` which returns a string the model can read. The wiki /
memory / propose_view tools from the TS app come in later chunks.

Why strings as return values: OpenAI tool messages carry only `content: str`.
We marshal everything to compact markdown or JSON so the model sees structured
output without needing nested parts.
"""
from __future__ import annotations

import json
from typing import Any

import psycopg
from psycopg.rows import dict_row

from ..audit import audit
from ..config import get_settings
from ..db import get_conn
from . import generate_chart as _chart_tool
from . import generate_presentation as _ppt_tool
from . import generate_report as _report_tool
from . import plan as _plan_tool
from . import wiki_tools as _wiki_tools
from .sql_guard import UnsafeSqlError, assert_select_only

# ─── OpenAI tool specs ────────────────────────────────────────────────────


TOOLS: list[dict[str, Any]] = [
    *_plan_tool.TOOLS,
    *_wiki_tools.TOOLS,
    *_chart_tool.TOOLS,
    *_report_tool.TOOLS,
    *_ppt_tool.TOOLS,
    {
        "type": "function",
        "function": {
            "name": "list_tables",
            "description": (
                "List every connected table the catalog knows about, with row count and status. "
                "Use this once at the start of a session to anchor your mental model."
            ),
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "describe_table",
            "description": (
                "Return the structural + semantic markdown doc for one table — columns, types, FKs, "
                "sample values, common joins. Use INSTEAD of run_sql when you need to learn what's "
                "in a table."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "schema": {"type": "string", "description": "Schema name, e.g. public"},
                    "table": {"type": "string", "description": "Table name"},
                },
                "required": ["schema", "table"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sample_rows",
            "description": "Return up to 5 sample rows from a connected table.",
            "parameters": {
                "type": "object",
                "properties": {
                    "schema": {"type": "string"},
                    "table": {"type": "string"},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 5},
                },
                "required": ["schema", "table"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_sql",
            "description": (
                "Execute a read-only SELECT against the connected source. Rejects anything that "
                "isn't a single SELECT. Returns up to 100 rows."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "sql": {"type": "string", "description": "A single SELECT statement"},
                },
                "required": ["sql"],
                "additionalProperties": False,
            },
        },
    },
]


# ─── Dispatcher ───────────────────────────────────────────────────────────


async def run_tool(name: str, args: dict[str, Any]) -> str:
    """Execute one tool by name. Always returns a string (never raises) so the
    agent loop can show errors back to the model.
    """
    try:
        if name == "plan":
            return await _plan_tool.run_tool(name, args)
        if name in ("browse_wiki", "search_wiki", "open_wiki_page"):
            return await _wiki_tools.run_tool(name, args, conversation_id="default")
        if name == "generate_chart":
            return await _chart_tool.run_tool(name, args, conversation_id="default")
        if name == "generate_report":
            return await _report_tool.run_tool(name, args, conversation_id="default")
        if name == "generate_presentation":
            return await _ppt_tool.run_tool(name, args, conversation_id="default")
        if name == "list_tables":
            return await _list_tables()
        if name == "describe_table":
            return await _describe_table(args["schema"], args["table"])
        if name == "sample_rows":
            return await _sample_rows(args["schema"], args["table"], int(args.get("limit", 5)))
        if name == "run_sql":
            return await _run_sql(args["sql"])
        return _err(f"Unknown tool: {name}")
    except Exception as e:  # noqa: BLE001
        return _err(f"{type(e).__name__}: {e}")


# ─── Tool implementations ─────────────────────────────────────────────────


async def _list_tables() -> str:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT t.schema_name, t.table_name, t.row_count, t.status
                  FROM tables t
                 ORDER BY t.schema_name, t.table_name
                """
            )
            rows = await cur.fetchall()
    if not rows:
        return "_No tables in the catalog yet. The boot loops are still running._"
    lines = ["| Schema | Table | Rows | Status |", "| --- | --- | --- | --- |"]
    for r in rows:
        lines.append(f"| {r['schema_name']} | {r['table_name']} | {r['row_count'] or 0} | {r['status']} |")
    await audit("agent", "tool:list_tables", None, {"count": len(rows)})
    return "\n".join(lines)


async def _describe_table(schema: str, table: str) -> str:
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT d.markdown
                  FROM docs d
                  JOIN tables t ON t.id = d.table_id
                 WHERE t.schema_name = %s AND t.table_name = %s
                """,
                (schema, table),
            )
            row = await cur.fetchone()
    if row is None or row[0] is None:
        return _err(f"No doc found for {schema}.{table}. Maybe Loop 1/2 haven't finished yet.")
    await audit("agent", "tool:describe_table", f"{schema}.{table}", {})
    return str(row[0])


async def _sample_rows(schema: str, table: str, limit: int) -> str:
    settings = get_settings()
    async with await psycopg.AsyncConnection.connect(settings.source_url) as src:
        async with src.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                f'SELECT * FROM "{schema}"."{table}" LIMIT %s', (limit,)
            )
            rows = await cur.fetchall()
    await audit("agent", "tool:sample_rows", f"{schema}.{table}", {"limit": limit})
    return _json(rows)


_RUN_SQL_LIMIT = 100


async def _run_sql(sql: str) -> str:
    try:
        cleaned = assert_select_only(sql)
    except UnsafeSqlError as e:
        await audit("agent", "tool:run_sql_blocked", None, {"sql": sql[:500], "reason": str(e)})
        return _err(f"Blocked: {e}")

    settings = get_settings()
    async with await psycopg.AsyncConnection.connect(settings.source_url) as src:
        async with src.cursor(row_factory=dict_row) as cur:
            await cur.execute(cleaned)
            rows = await cur.fetchmany(_RUN_SQL_LIMIT)
            row_count = cur.rowcount
    await audit(
        "agent", "tool:run_sql", None, {"sql": cleaned[:500], "row_count": len(rows)}
    )
    if not rows:
        return f"_(0 rows; rowcount={row_count})_"
    return _json(rows)


# ─── Marshalling helpers ──────────────────────────────────────────────────


def _err(msg: str) -> str:
    return json.dumps({"error": msg})


def _json(rows: list[dict[str, Any]]) -> str:
    def fallback(v: Any) -> Any:
        return str(v)

    return json.dumps(rows, default=fallback, indent=2)
