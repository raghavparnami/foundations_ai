"""Port of src/lib/agent/generate-chart.ts — the `generate_chart` agent tool.

Saves a lightweight chart spec (bar / line / pie / area + axis fields + data
rows) and returns a slug the UI uses to render via Recharts. The spec is
intentionally simple — not Vega-Lite — so the model doesn't need to know a
complex grammar.
"""
from __future__ import annotations

import json
import logging
import re
import time
from typing import Any

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from ..audit import audit
from ..db import get_conn

log = logging.getLogger(__name__)


_CHART_TYPES = ("bar", "line", "pie", "area")


TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "generate_chart",
            "description": (
                "Save a chart (bar/line/pie/area) the user can see inline. Pass `spec` with `type`, "
                "`title`, `x_field`, `y_field`, and a `data` array of rows. Use this after running a "
                "small aggregate (≤ 20 rows) — bigger result sets belong in a table or view."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "spec": {
                        "type": "object",
                        "properties": {
                            "type": {"type": "string", "enum": list(_CHART_TYPES)},
                            "title": {"type": "string"},
                            "x_field": {"type": "string"},
                            "y_field": {"type": "string"},
                            "series_field": {"type": "string"},
                            "data": {
                                "type": "array",
                                "items": {"type": "object"},
                                "minItems": 1,
                                "description": "Non-empty array of {x_field: ..., y_field: ...} rows.",
                            },
                        },
                        "required": ["type", "title", "x_field", "y_field", "data"],
                    },
                    "slug": {
                        "type": "string",
                        "description": "Optional stable slug. Defaults to a sluggified title.",
                    },
                },
                "required": ["spec"],
                "additionalProperties": False,
            },
        },
    },
]


async def run_tool(name: str, args: dict[str, Any], *, conversation_id: str) -> str:
    """Dispatch for generate_chart. Returns a JSON string."""
    try:
        if name == "generate_chart":
            return _json(
                await generate_chart(
                    spec=args["spec"],
                    slug=args.get("slug"),
                    conversation_id=conversation_id,
                )
            )
        return _json({"error": f"Unknown tool: {name}"})
    except Exception as e:  # noqa: BLE001
        log.exception("generate_chart.run_tool failed: %s", name)
        return _json({"error": f"{type(e).__name__}: {e}"})


async def generate_chart(
    *,
    spec: dict[str, Any],
    slug: str | None,
    conversation_id: str,
) -> dict[str, Any]:
    """Persist a chart spec and return the rendered preview URL."""
    if not isinstance(spec, dict):
        return {"ok": False, "error": "spec is required"}
    chart_type = spec.get("type")
    if chart_type not in _CHART_TYPES:
        return {"ok": False, "error": "spec.type must be one of: bar, line, pie, area"}
    title = (spec.get("title") or "").strip()
    if not title:
        return {"ok": False, "error": "spec.title is required"}
    if not spec.get("x_field") or not spec.get("y_field"):
        return {"ok": False, "error": "spec.x_field and spec.y_field are required"}
    data = spec.get("data")
    if not isinstance(data, list) or not data:
        return {"ok": False, "error": "spec.data must be a non-empty array of rows"}

    final_slug = _sanitize_slug(slug or title) or f"chart-{int(time.time() * 1000)}"

    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                INSERT INTO charts (slug, title, spec, conversation_id)
                     VALUES (%s, %s, %s, %s)
                ON CONFLICT (slug) DO UPDATE
                   SET title = EXCLUDED.title,
                       spec = EXCLUDED.spec,
                       conversation_id = EXCLUDED.conversation_id,
                       created_at = now()
                RETURNING id, slug
                """,
                (final_slug, title, Jsonb(spec), conversation_id),
            )
            row = await cur.fetchone()
            assert row is not None

    await audit(
        "agent",
        "generate_chart",
        row["slug"],
        {
            "conversationId": conversation_id,
            "type": chart_type,
            "rows": len(data),
        },
    )
    # NOTE: deliberately do NOT return a URL. The UI renders the chart inline
    # from the spec the model already sent in the tool input. Returning a URL
    # caused the model to paste markdown image / link syntax back into prose.
    return {
        "ok": True,
        "slug": row["slug"],
        "title": title,
        "type": chart_type,
        "rendered_inline": True,
    }


_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,80}$")


def _sanitize_slug(raw: str) -> str | None:
    s = raw.strip().lower()
    s = re.sub(r"\s+", "-", s)
    s = re.sub(r"[^a-z0-9-]", "", s)
    s = re.sub(r"-+", "-", s)
    s = s.strip("-")
    return s if _SLUG_RE.match(s) else None


def _json(value: Any) -> str:
    return json.dumps(value, default=str)
