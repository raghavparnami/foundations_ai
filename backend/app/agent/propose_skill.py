"""Port of src/lib/agent/propose-skill.ts — the `propose_skill` agent tool.

Stages a skill candidate in `skill_candidates` with status='pending'. The UI
renders an accept/dismiss card; only on accept is the row written into the
real `skills` table. Skills steer the agent on every matching turn, so we
never auto-add one without user approval.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from ..audit import audit
from ..db import get_conn

log = logging.getLogger(__name__)


TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "propose_skill",
            "description": (
                "Stage a candidate analytical skill (playbook) for user approval. Use this when a chat "
                "produces canonizable knowledge — a domain definition, a formula, a 'this is how we "
                "measure X' rule — worth pinning so future chats trigger the same playbook. The skill "
                "is NOT enabled immediately; it appears as a pending card the user accepts or dismisses."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Human-readable skill name (e.g. 'Deviation Rate by Line').",
                    },
                    "description": {
                        "type": "string",
                        "description": "One-line summary of what the skill teaches.",
                    },
                    "triggers": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": 1,
                        "description": "Keywords / phrases that activate the skill on a future turn.",
                    },
                    "body_md": {
                        "type": "string",
                        "minLength": 40,
                        "description": (
                            "Substantive markdown body. Include 'What it is', a formula or SQL "
                            "template, and 'When to use'."
                        ),
                    },
                },
                "required": ["name", "description", "triggers", "body_md"],
                "additionalProperties": False,
            },
        },
    },
]


async def run_tool(name: str, args: dict[str, Any], *, conversation_id: str | None = None) -> str:
    """Dispatch for propose_skill. Returns a JSON string."""
    try:
        if name == "propose_skill":
            triggers_raw = args.get("triggers") or []
            triggers = (
                [str(t) for t in triggers_raw]
                if isinstance(triggers_raw, list)
                else []
            )
            return _json(
                await propose_skill_candidate(
                    name=args["name"],
                    description=args["description"],
                    triggers=triggers,
                    body_md=args["body_md"],
                    conversation_id=conversation_id,
                )
            )
        return _json({"error": f"Unknown tool: {name}"})
    except Exception as e:  # noqa: BLE001
        log.exception("propose_skill.run_tool failed: %s", name)
        return _json({"error": f"{type(e).__name__}: {e}"})


async def propose_skill_candidate(
    *,
    name: str,
    description: str,
    triggers: list[str],
    body_md: str,
    conversation_id: str | None,
) -> dict[str, Any]:
    """Stage a pending skill_candidate. Dedupes against existing pending rows."""
    name = name.strip()
    if not name:
        return {"ok": False, "error": "name is required"}
    desc = description.strip()
    if not desc:
        return {"ok": False, "error": "description is required"}
    cleaned_triggers = [t.strip() for t in triggers if isinstance(t, str) and t.strip()]
    if not cleaned_triggers:
        return {"ok": False, "error": "at least one trigger keyword is required"}
    body = body_md.strip()
    if len(body) < 40:
        return {
            "ok": False,
            "error": (
                "body_md must be substantive — include 'What it is', a formula or SQL template, "
                "and 'When to use'."
            ),
        }

    slug = _sanitize_slug(name)
    if not slug:
        return {"ok": False, "error": "invalid name (use letters/digits/hyphens)"}

    # No explicit UNIQUE on (conversation_id, slug, status), so do a manual
    # find-existing-pending; only insert fresh if there's nothing to update.
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT id FROM skill_candidates
                 WHERE conversation_id = %s AND slug = %s AND status = 'pending'
                 ORDER BY created_at DESC LIMIT 1
                """,
                (conversation_id, slug),
            )
            existing = await cur.fetchone()

            if existing:
                cand_id = int(existing["id"])
                await cur.execute(
                    """
                    UPDATE skill_candidates
                       SET name = %s,
                           description = %s,
                           triggers = %s,
                           body_md = %s
                     WHERE id = %s
                    """,
                    (name, desc, Jsonb(cleaned_triggers), body, cand_id),
                )
            else:
                await cur.execute(
                    """
                    INSERT INTO skill_candidates
                        (conversation_id, slug, name, description, triggers, body_md)
                         VALUES (%s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        conversation_id,
                        slug,
                        name,
                        desc,
                        Jsonb(cleaned_triggers),
                        body,
                    ),
                )
                fresh = await cur.fetchone()
                assert fresh is not None
                cand_id = int(fresh["id"])

    await audit(
        "agent",
        "propose_skill",
        slug,
        {
            "conversationId": conversation_id,
            "candidate_id": cand_id,
            "triggers": len(cleaned_triggers),
        },
    )
    return {"ok": True, "candidate_id": cand_id, "slug": slug}


_SLUG_RE = re.compile(r"^[a-z][a-z0-9-]{1,60}$")


def _sanitize_slug(raw: str) -> str | None:
    s = raw.strip().lower()
    s = re.sub(r"\s+", "-", s)
    s = re.sub(r"[^a-z0-9-]", "", s)
    s = re.sub(r"-+", "-", s)
    s = s.strip("-")
    return s if _SLUG_RE.match(s) else None


def _json(value: Any) -> str:
    return json.dumps(value, default=str)
