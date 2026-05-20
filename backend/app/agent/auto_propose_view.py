"""Port of src/lib/agent/auto-propose-view.ts — server-side view safety net.

We instruct the agent to call `propose_view` after every view-worthy `run_sql`,
but model compliance is imperfect. After a turn completes, this scans the
assistant's tool calls and auto-creates a view for any view-worthy `run_sql`
that wasn't already paired with a `propose_view`.

Heuristic for "view-worthy":
  - SQL contains aggregation (COUNT/SUM/AVG/MAX/MIN/GROUP BY/window fns)
  - AND has a WHERE clause OR joins 2+ tables OR has GROUP BY
  - AND is NOT a bare scalar lookup like `SELECT COUNT(*) FROM t` w/o filters

Name generation: extract the first FROM table + hash of normalized SQL so the
same query produces the same view name (idempotent).
"""
from __future__ import annotations

import hashlib
import logging
import re
from typing import Any

from ..audit import audit
from .propose_view import propose_view

log = logging.getLogger(__name__)


async def auto_propose_missed_views(
    tool_calls: list[dict[str, Any]],
    conversation_id: str,
    user_question: str,
) -> None:
    """Walk tool calls, create views for any view-worthy run_sql we missed.

    `tool_calls` is a list of dicts shaped roughly like AI SDK message parts:
    each entry should have `name` (tool name), optional `args`/`input`,
    optional `result`/`output`, optional `state`.
    """
    run_sql_calls = [
        p
        for p in tool_calls
        if _tool_name(p) == "run_sql" and _is_completed(p) and not _is_errored(p)
    ]
    proposed_names: set[str] = {
        _sanitize_lower(str(_args_of(p).get("name", "")))
        for p in tool_calls
        if _tool_name(p) == "propose_view"
    }

    for p in run_sql_calls:
        sql = _args_of(p).get("sql")
        if not isinstance(sql, str):
            continue
        if not _is_view_worthy(sql):
            continue

        base_name = _generate_name(sql)
        if any(n and (n in base_name or base_name in n) for n in proposed_names):
            continue

        try:
            r = await propose_view(
                name=base_name,
                sql=sql,
                description=_short_description(user_question),
            )
        except Exception as e:  # noqa: BLE001
            log.warning("auto_propose_view.failed err=%s", e)
            continue

        if r.get("ok"):
            await audit(
                "system",
                "auto_propose_view",
                r.get("qualified_name"),
                {
                    "conversationId": conversation_id,
                    "reason": "agent_missed",
                    "sql_bytes": len(sql),
                },
            )
            log.info("auto_propose_view.created name=%s", r.get("qualified_name"))
        else:
            log.info("auto_propose_view.rejected error=%s", r.get("error"))


def _tool_name(part: dict[str, Any]) -> str:
    """Recover the tool name from either a flat dict or AI SDK UI part shape."""
    if "name" in part and isinstance(part["name"], str):
        return part["name"]
    t = part.get("type")
    if isinstance(t, str) and t.startswith("tool-"):
        return t[len("tool-") :]
    return ""


def _args_of(part: dict[str, Any]) -> dict[str, Any]:
    for k in ("args", "input", "arguments"):
        v = part.get(k)
        if isinstance(v, dict):
            return v
    return {}


def _is_completed(part: dict[str, Any]) -> bool:
    state = part.get("state")
    if isinstance(state, str):
        return state in {"output-available", "result", "completed", "success"}
    return any(k in part for k in ("output", "result"))


def _is_errored(part: dict[str, Any]) -> bool:
    for k in ("output", "result"):
        v = part.get(k)
        if isinstance(v, dict) and v.get("error"):
            return True
    return False


_VIEW_WORTHY_AGG_RE = re.compile(r"\b(COUNT|SUM|AVG|MAX|MIN)\s*\(", re.IGNORECASE)
_GROUP_BY_RE = re.compile(r"\bGROUP\s+BY\b", re.IGNORECASE)
_RANK_RE = re.compile(r"\bRANK\s*\(", re.IGNORECASE)
_ROW_NUMBER_RE = re.compile(r"\bROW_NUMBER\s*\(", re.IGNORECASE)
_WHERE_RE = re.compile(r"\bWHERE\b", re.IGNORECASE)
_JOIN_RE = re.compile(r"\bJOIN\b", re.IGNORECASE)
_BARE_SCALAR_RE = re.compile(
    r"^\s*SELECT\s+COUNT\s*\(\s*\*\s*\)\s*(AS\s+\w+\s*)?\s*FROM\s+[\w.\"]+\s*;?\s*$",
    re.IGNORECASE,
)


def _is_view_worthy(sql: str) -> bool:
    has_agg = bool(
        _VIEW_WORTHY_AGG_RE.search(sql)
        or _GROUP_BY_RE.search(sql)
        or _RANK_RE.search(sql)
        or _ROW_NUMBER_RE.search(sql)
    )
    has_filter = bool(_WHERE_RE.search(sql))
    has_join = bool(_JOIN_RE.search(sql))
    has_group_by = bool(_GROUP_BY_RE.search(sql))

    if _BARE_SCALAR_RE.match(sql):
        return False
    return has_agg and (has_filter or has_join or has_group_by)


_FROM_RE = re.compile(r'\bFROM\s+(?:"?(\w+)"?\.)?"?(\w+)"?', re.IGNORECASE)
_SAFE_TABLE_RE = re.compile(r"[^a-z0-9_]")


def _generate_name(sql: str) -> str:
    m = _FROM_RE.search(sql)
    table = (m.group(2) if m else "result").lower()
    norm = re.sub(r"\s+", " ", sql).strip().lower()
    digest = hashlib.md5(norm.encode("utf-8")).hexdigest()[:6]
    safe_table = _SAFE_TABLE_RE.sub("", table)
    return f"{safe_table}_{digest}"


def _sanitize_lower(n: str) -> str:
    return re.sub(r"[^a-z0-9_]", "", n.lower())


def _short_description(user_question: str) -> str:
    return (
        "Auto-saved by Loom because the underlying query had aggregation/filters and was likely "
        f'to be re-asked. Originated from: "{user_question[:200]}"'
    )
