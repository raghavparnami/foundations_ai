"""Port of src/lib/agent/propose-view.ts — the `propose_view` agent tool.

Given a SELECT and a desired view name, this:
  1. Sanitises the view name (lowercase, underscore, optional `v_` prefix).
  2. Validates the SQL through the central `sql_guard` (SELECT-only).
  3. Ensures the `loom_views` schema exists on the source DB.
  4. Enforces a soft cap of 100 fresh views per source.
  5. Runs `CREATE OR REPLACE VIEW loom_views.<name> AS <sql>`.
  6. Introspects the resulting columns via `information_schema.columns`.
  7. Registers the view in the catalog (`tables`, `columns`, `docs`).
  8. Records a `proposals` row + audit entry.

"Propose" matches the CLAUDE.md vocabulary; in v0.1 we still apply on call.
The proposals table records the full SQL so a review queue can be bolted on
later with no schema change.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from ..audit import audit
from ..config import get_settings
from ..db import get_conn
from .sql_guard import UnsafeSqlError, assert_select_only

log = logging.getLogger(__name__)

_SOURCE_NAME = "factory_demo"
_VIEW_SCHEMA = "loom_views"
_VIEW_CAP = 100


TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "propose_view",
            "description": (
                "Save a SELECT as a named view in `loom_views.<name>` on the source DB and register "
                "it in the catalog. Call this after writing a meaningful aggregate, join, or filter — "
                "anything the user is likely to re-ask. The view name should describe the metric "
                "('failed_runs_by_line'); a `v_` prefix is added automatically if absent."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Human-friendly view name (lowercase, digits, underscores).",
                    },
                    "sql": {
                        "type": "string",
                        "description": "A single SELECT statement. Cannot contain DML/DDL.",
                    },
                    "description": {
                        "type": "string",
                        "description": "One-sentence summary that goes into the generated wiki doc.",
                    },
                },
                "required": ["name", "sql"],
                "additionalProperties": False,
            },
        },
    },
]


async def run_tool(name: str, args: dict[str, Any], *, conversation_id: str | None = None) -> str:
    """Dispatch for propose_view. Always returns a JSON string."""
    try:
        if name == "propose_view":
            return _json(
                await propose_view(
                    name=args["name"],
                    sql=args["sql"],
                    description=args.get("description"),
                )
            )
        return _json({"error": f"Unknown tool: {name}"})
    except Exception as e:  # noqa: BLE001
        log.exception("propose_view.run_tool failed: %s", name)
        return _json({"error": f"{type(e).__name__}: {e}"})


async def propose_view(
    *,
    name: str,
    sql: str,
    description: str | None = None,
) -> dict[str, Any]:
    """Create / update a view on the source DB and register it in the catalog."""
    # 1. Sanitise the name.
    safe_name = _sanitize_view_name(name)
    if not safe_name:
        return {
            "ok": False,
            "error": (
                f'Invalid view name "{name}". Use lowercase letters, digits, and underscores; '
                "start with a letter."
            ),
        }

    # 2. SQL guard.
    try:
        cleaned = assert_select_only(sql)
    except UnsafeSqlError as e:
        return {"ok": False, "error": f"Rejected by SQL guard: {e}"}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"SQL parse failed: {e}"}

    settings = get_settings()
    qualified = f"{_VIEW_SCHEMA}.{safe_name}"

    # 3-5. Talk to the source DB.
    try:
        async with await psycopg.AsyncConnection.connect(settings.source_url) as src:
            await src.set_autocommit(True)
            async with src.cursor(row_factory=dict_row) as cur:
                # 3a. Ensure schema exists.
                await cur.execute(f'CREATE SCHEMA IF NOT EXISTS "{_VIEW_SCHEMA}"')

                # 3b. Soft cap: fresh creates only.
                await cur.execute(
                    """
                    SELECT count(*)::int AS n
                      FROM information_schema.views
                     WHERE table_schema = %s AND table_name = %s
                    """,
                    (_VIEW_SCHEMA, safe_name),
                )
                exists_row = await cur.fetchone()
                is_update = bool(exists_row and int(exists_row["n"]) > 0)
                if not is_update:
                    await cur.execute(
                        "SELECT count(*)::int AS n FROM information_schema.views WHERE table_schema = %s",
                        (_VIEW_SCHEMA,),
                    )
                    total_row = await cur.fetchone()
                    total = int(total_row["n"]) if total_row else 0
                    if total >= _VIEW_CAP:
                        return {
                            "ok": False,
                            "error": (
                                f"View limit reached: this database already has {total} views in "
                                f"`{_VIEW_SCHEMA}` (max {_VIEW_CAP}). Delete an unused view in /admin "
                                "and try again."
                            ),
                        }

                # 4. Create or replace the view.
                try:
                    await cur.execute(
                        f'CREATE OR REPLACE VIEW "{_VIEW_SCHEMA}"."{safe_name}" AS {cleaned}'
                    )
                except Exception as e:  # noqa: BLE001
                    return {"ok": False, "error": f"Postgres rejected the view: {e}"}

                # 5. Introspect columns.
                await cur.execute(
                    """
                    SELECT column_name, ordinal_position, data_type, is_nullable
                      FROM information_schema.columns
                     WHERE table_schema = %s AND table_name = %s
                     ORDER BY ordinal_position
                    """,
                    (_VIEW_SCHEMA, safe_name),
                )
                cols = await cur.fetchall()

                # 6. Row count (best-effort; cap is enforced by the underlying view).
                row_count = 0
                try:
                    await cur.execute(
                        f'SELECT count(*)::int AS n FROM "{_VIEW_SCHEMA}"."{safe_name}"'
                    )
                    rc_row = await cur.fetchone()
                    row_count = int(rc_row["n"]) if rc_row else 0
                except Exception:  # noqa: BLE001
                    row_count = 0
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"Postgres rejected the view check: {e}"}

    # 7. Register in the catalog.
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                "SELECT id FROM sources WHERE name = %s",
                (_SOURCE_NAME,),
            )
            src_row = await cur.fetchone()
            if not src_row:
                return {
                    "ok": False,
                    "error": "Source not registered yet — wait for boot to complete.",
                }
            source_id = int(src_row["id"])

            await cur.execute(
                """
                INSERT INTO tables (source_id, schema_name, table_name, row_count, status, last_profiled_at)
                     VALUES (%s, %s, %s, %s, 'ready', now())
                ON CONFLICT (source_id, schema_name, table_name) DO UPDATE
                   SET row_count = EXCLUDED.row_count,
                       status = 'ready',
                       last_profiled_at = now()
                RETURNING id
                """,
                (source_id, _VIEW_SCHEMA, safe_name, row_count),
            )
            tr = await cur.fetchone()
            assert tr is not None
            table_id = int(tr["id"])

            # Clear & repopulate columns for the view.
            await cur.execute("DELETE FROM columns WHERE table_id = %s", (table_id,))
            for c in cols:
                await cur.execute(
                    """
                    INSERT INTO columns (table_id, column_name, ordinal, data_type, is_nullable, is_primary)
                         VALUES (%s, %s, %s, %s, %s, FALSE)
                    """,
                    (
                        table_id,
                        c["column_name"],
                        c["ordinal_position"],
                        c["data_type"],
                        c["is_nullable"] == "YES",
                    ),
                )

            md = _render_view_doc(qualified, description, cleaned, cols, row_count)
            path = f"loom-catalog/{_SOURCE_NAME}/{_VIEW_SCHEMA}/{safe_name}.md"
            await cur.execute(
                """
                INSERT INTO docs (table_id, path, markdown, provenance, updated_at)
                     VALUES (%s, %s, %s, %s, now())
                ON CONFLICT (table_id) DO UPDATE
                   SET path = EXCLUDED.path,
                       markdown = EXCLUDED.markdown,
                       provenance = EXCLUDED.provenance,
                       updated_at = now()
                """,
                (table_id, path, md, Jsonb({"schema": 1, "claude": 1})),
            )

            # 8. proposals + audit.
            await cur.execute(
                """
                INSERT INTO proposals (kind, name, description, sql, status)
                     VALUES ('view', %s, %s, %s, 'applied')
                ON CONFLICT (kind, name) DO UPDATE
                   SET description = EXCLUDED.description,
                       sql = EXCLUDED.sql,
                       status = 'applied',
                       created_at = now()
                """,
                (safe_name, description, cleaned),
            )

    await audit(
        "agent",
        "propose_view",
        qualified,
        {"columns": len(cols), "row_count": row_count, "bytes": len(cleaned)},
    )

    return {
        "ok": True,
        "view_name": safe_name,
        "qualified_name": qualified,
        "view_id": table_id,
        "columns": [{"name": c["column_name"], "data_type": c["data_type"]} for c in cols],
        "row_count": row_count,
    }


# ─── Helpers ─────────────────────────────────────────────────────────────


_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{0,60}$")
_NAME_STRIP_RE = re.compile(r"[^a-z0-9_]")


def _sanitize_view_name(raw: str) -> str | None:
    """Mirror the TS sanitizer: lowercase, underscores, optional `v_` prefix."""
    trimmed = raw.strip().lower()
    replaced = _NAME_STRIP_RE.sub("", re.sub(r"\s+", "_", trimmed))
    if not _NAME_RE.match(replaced):
        return None
    return replaced if replaced.startswith("v_") else f"v_{replaced}"


def _render_view_doc(
    qualified: str,
    description: str | None,
    sql: str,
    cols: list[dict[str, Any]],
    row_count: int,
) -> str:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    col_table_rows = [f"| `{c['column_name']}` | {c['data_type']} |" for c in cols]
    col_table = "\n".join(["| Column | Type |", "| --- | --- |", *col_table_rows])
    desc = (description or "").strip() or "_No description provided._"
    suffix = "" if row_count == 1 else "s"
    return "\n".join(
        [
            f"# {qualified}",
            "",
            "<!-- provenance: schema -->",
            f"This is a **view** created by Loom. {row_count} row{suffix} as of {today}.",
            "",
            f"<!-- provenance: claude, {today} -->",
            "## What this view represents",
            desc,
            "",
            "## Definition",
            "",
            "```sql",
            sql,
            "```",
            "",
            "<!-- provenance: schema -->",
            "## Columns",
            "",
            col_table,
            "",
        ]
    )


def _json(value: Any) -> str:
    return json.dumps(value, default=str)
