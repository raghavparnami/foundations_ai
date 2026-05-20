"""Port of src/lib/agent/plan.ts — the `plan` tool.

Forces the agent to commit upfront to a small ordered list of steps before
calling any other tool. Has no side-effects beyond an audit entry; the steps
are simply echoed back so the UI can render them as a checklist that ticks as
subsequent tool calls land.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from ..audit import audit

log = logging.getLogger(__name__)


TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "plan",
            "description": (
                "Commit upfront to the steps you will take to answer the user's question. Call this "
                "FIRST on every turn, before any other tool. Steps should be short (5–10 words each), "
                "ordered, and map roughly one-to-one with the tools you will call. Examples of good "
                "steps: 'Look up the deviations table', 'Run aggregate by line', 'Save view', "
                "'Plot a bar chart'. DON'T call this if the question is purely conversational "
                "('hello', a simple clarification)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "steps": {
                        "type": "array",
                        "items": {"type": "string", "minLength": 2, "maxLength": 80},
                        "minItems": 2,
                        "maxItems": 8,
                        "description": "Ordered, concise steps. Minimum 2, maximum 8.",
                    },
                },
                "required": ["steps"],
                "additionalProperties": False,
            },
        },
    },
]


async def run_tool(name: str, args: dict[str, Any], *, conversation_id: str | None = None) -> str:
    """Dispatch for plan. Returns a JSON string."""
    try:
        if name == "plan":
            steps_raw = args.get("steps") or []
            steps = [str(s) for s in steps_raw] if isinstance(steps_raw, list) else []
            return _json(await plan(steps=steps, conversation_id=conversation_id))
        return _json({"error": f"Unknown tool: {name}"})
    except Exception as e:  # noqa: BLE001
        log.exception("plan.run_tool failed: %s", name)
        return _json({"error": f"{type(e).__name__}: {e}"})


async def plan(*, steps: list[str], conversation_id: str | None = None) -> dict[str, Any]:
    """Echo the steps back to the agent (and audit) — no side-effects."""
    await audit(
        "agent",
        "tool:plan",
        None,
        {"conversationId": conversation_id, "n_steps": len(steps)},
    )
    return {
        "ok": True,
        "steps": [{"id": i, "label": label} for i, label in enumerate(steps)],
    }


def _json(value: Any) -> str:
    return json.dumps(value, default=str)
