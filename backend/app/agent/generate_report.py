"""Port of src/lib/agent/generate-report.ts — the `generate_report` agent tool.

Persists a markdown report in the `reports` table and returns a download URL
the UI surfaces as a clickable chip.
"""
from __future__ import annotations

import json
import logging
import re
import time
from typing import Any

from psycopg.rows import dict_row

from ..audit import audit
from ..db import get_conn

log = logging.getLogger(__name__)


TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "generate_report",
            "description": (
                "Save a markdown report the user can download. Use this for any final write-up that's "
                "longer than a paragraph — analyses, post-mortems, weekly summaries. Returns a "
                "`download_url` the UI surfaces as a chip."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Report title."},
                    "body_md": {
                        "type": "string",
                        "description": "Full markdown body. Headings, bullets, tables, code blocks all fine.",
                    },
                    "slug": {
                        "type": "string",
                        "description": "Optional stable slug. Defaults to a sluggified title.",
                    },
                },
                "required": ["title", "body_md"],
                "additionalProperties": False,
            },
        },
    },
]


async def run_tool(name: str, args: dict[str, Any], *, conversation_id: str) -> str:
    """Dispatch for generate_report. Returns a JSON string."""
    try:
        if name == "generate_report":
            return _json(
                await generate_report(
                    title=args["title"],
                    body_md=args["body_md"],
                    slug=args.get("slug"),
                    conversation_id=conversation_id,
                )
            )
        return _json({"error": f"Unknown tool: {name}"})
    except Exception as e:  # noqa: BLE001
        log.exception("generate_report.run_tool failed: %s", name)
        return _json({"error": f"{type(e).__name__}: {e}"})


async def generate_report(
    *,
    title: str,
    body_md: str,
    slug: str | None,
    conversation_id: str,
) -> dict[str, Any]:
    """Save the report and return a download URL."""
    title = (title or "").strip()
    if not title:
        return {"ok": False, "error": "title is required"}
    body = (body_md or "").strip()
    if not body:
        return {"ok": False, "error": "body_md is required"}

    final_slug = _sanitize_slug(slug or title) or f"report-{int(time.time() * 1000)}"

    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                INSERT INTO reports (slug, title, body_md, conversation_id)
                     VALUES (%s, %s, %s, %s)
                ON CONFLICT (slug) DO UPDATE
                   SET title = EXCLUDED.title,
                       body_md = EXCLUDED.body_md,
                       conversation_id = EXCLUDED.conversation_id,
                       created_at = now()
                RETURNING id, slug
                """,
                (final_slug, title, body, conversation_id),
            )
            row = await cur.fetchone()
            assert row is not None

    await audit(
        "agent",
        "generate_report",
        row["slug"],
        {"conversationId": conversation_id, "bytes": len(body)},
    )
    return {
        "ok": True,
        "slug": row["slug"],
        "title": title,
        "download_url": f"/api/reports/{row['slug']}/download",
        "bytes": len(body),
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
