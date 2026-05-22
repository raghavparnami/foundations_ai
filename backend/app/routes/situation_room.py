"""GET /api/situation-room/snapshot — live findings for the 6 SMEs.

Architecture is Claude-Code-style on-demand:
  - No background loop. Snapshot is computed when the frontend asks.
  - 6 small SQL probes per call (one per SME) against the source DB.
  - Server-side TTL cache (default 60s) so polling at 30s = ~1 probe/min.
  - Zero LLM tokens. The finding strings are formatted from query results
    using static templates. The LLM only fires when the user opens a
    Standing Meeting (already on-demand).

Per-SME findings:
  marcus  → top line by 30-day deviation rate (`v_deviation_rate_by_line_30d`)
  iris    → top 24-hour critical anomaly category (`public.deviations`)
  quinn   → top quality parameter by 7-day failure rate (`public.quality_checks`)
  sasha   → no supply-chain tables in this catalog → idle
  mason   → top equipment by 30-day deviation count (`public.deviations`)
  sage    → unresolved critical deviations count (`public.deviations`)

The PINNED incident (if any) is promoted from whichever SME has the
single most severe finding — see `_derive_pinned`.

Add a new SME or change thresholds by editing PROBES below. No other
file should need to change.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

import psycopg
from psycopg.rows import dict_row
from fastapi import APIRouter
from pydantic import BaseModel

from app.config import get_settings

log = logging.getLogger(__name__)
router = APIRouter()

CACHE_TTL_SEC = 60.0
_cache: tuple[float, dict[str, Any]] | None = None
_cache_lock = asyncio.Lock()


# ─── response models ─────────────────────────────────────────────────────


class SMEStationOut(BaseModel):
    sme_id: str
    status: str  # watching | alerting | recommending | idle
    status_label: str
    current_finding: str
    last_updated: str


class PinnedIncidentOut(BaseModel):
    id: str
    severity: str  # info | warning | critical
    headline: str
    subtext: str
    converging_sme_ids: list[str]
    started_at: str


class SnapshotResponse(BaseModel):
    shift_label: str
    stations: list[SMEStationOut]
    pinned_incident: PinnedIncidentOut | None
    fetched_at: str
    source: str  # "live" | "stale-fixture"


# ─── per-SME probes ──────────────────────────────────────────────────────


@dataclass(slots=True)
class Finding:
    status: str        # watching / alerting / recommending / idle
    label: str         # "Now watching" / "Alerting" / "Recommending" / "Idle"
    text: str          # one-line finding
    severity: int      # 0 (idle) .. 5 (critical) — used to pick the pinned card


Probe = Callable[[psycopg.AsyncConnection], Awaitable[Finding]]


async def _q(conn: psycopg.AsyncConnection, sql: str) -> list[dict[str, Any]]:
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(sql)
        return await cur.fetchall()


async def _probe_marcus(conn: psycopg.AsyncConnection) -> Finding:
    rows = await _q(
        conn,
        "SELECT line_id, deviation_rate FROM loom_views.v_deviation_rate_by_line_30d "
        "ORDER BY deviation_rate DESC NULLS LAST LIMIT 1",
    )
    if not rows:
        return Finding("idle", "Idle", "No production-run data available", 0)
    r = rows[0]
    rate_raw = r.get("deviation_rate")
    rate = float(rate_raw) if rate_raw is not None else 0.0
    line = r.get("line_id") or "?"
    pct = rate * 100 if rate <= 1.5 else rate
    if rate > 0.70 or pct > 70:
        return Finding(
            "alerting",
            "Alerting",
            f"OEE drift · {line} at {pct:.1f}% deviation in last 30d",
            4,
        )
    return Finding(
        "watching",
        "Now watching",
        f"OEE drift across lines · {line} highest at {pct:.1f}%",
        2,
    )


async def _probe_iris(conn: psycopg.AsyncConnection) -> Finding:
    rows = await _q(
        conn,
        "SELECT category, COUNT(*) AS n FROM public.deviations "
        "WHERE observed_at >= NOW() - INTERVAL '24 hours' "
        "  AND severity IN ('critical','high') "
        "GROUP BY category ORDER BY n DESC LIMIT 1",
    )
    if not rows:
        return Finding(
            "watching",
            "Now watching",
            "No critical sensor events in last 24h",
            1,
        )
    cat = (rows[0].get("category") or "anomaly").strip()
    n = int(rows[0].get("n") or 0)
    if n >= 5:
        return Finding(
            "alerting",
            "Alerting",
            f"{cat.capitalize()} anomaly · {n} critical events in last 24h",
            5,
        )
    return Finding(
        "watching",
        "Now watching",
        f"{cat.capitalize()} · {n} elevated events in last 24h",
        2,
    )


async def _probe_quinn(conn: psycopg.AsyncConnection) -> Finding:
    rows = await _q(
        conn,
        "SELECT parameter, "
        "       COUNT(*) FILTER (WHERE in_spec = false)::float "
        "       / NULLIF(COUNT(*), 0) AS fail_rate, "
        "       COUNT(*) AS total "
        "  FROM public.quality_checks "
        " WHERE checked_at >= NOW() - INTERVAL '7 days' "
        " GROUP BY parameter "
        " HAVING COUNT(*) >= 10 "
        " ORDER BY fail_rate DESC NULLS LAST LIMIT 1",
    )
    if not rows:
        return Finding(
            "watching",
            "Now watching",
            "No quality checks in last 7d",
            1,
        )
    param = (rows[0].get("parameter") or "parameter").strip()
    rate = float(rows[0].get("fail_rate") or 0)
    if rate > 0.15:
        return Finding(
            "alerting",
            "Alerting",
            f"Quality drift on {param} · {rate*100:.1f}% failure in last 7d",
            4,
        )
    return Finding(
        "watching",
        "Now watching",
        f"{param} · {rate*100:.1f}% failure rate in last 7d",
        2,
    )


async def _probe_sasha(_conn: psycopg.AsyncConnection) -> Finding:
    # No supply-chain tables in this demo catalog. Honest idle status with
    # an actionable hint until a real shipment/inventory source is wired.
    return Finding(
        "idle",
        "Idle",
        "No supply chain source connected · Connections → add Snowflake/SAP",
        0,
    )


async def _probe_mason(conn: psycopg.AsyncConnection) -> Finding:
    rows = await _q(
        conn,
        "SELECT e.equipment_id, e.name AS equipment_name, COUNT(*) AS n "
        "  FROM public.deviations d "
        "  JOIN public.equipment e ON e.equipment_id = d.equipment_id "
        " WHERE d.observed_at >= NOW() - INTERVAL '30 days' "
        " GROUP BY e.equipment_id, e.name "
        " ORDER BY n DESC LIMIT 1",
    )
    if not rows:
        return Finding("idle", "Idle", "No equipment events in last 30d", 0)
    name = rows[0].get("equipment_name") or "?"
    n = int(rows[0].get("n") or 0)
    if n >= 20:
        return Finding(
            "recommending",
            "Recommending",
            f"Pull {name} for service · {n} deviations in 30d",
            4,
        )
    return Finding(
        "watching",
        "Now watching",
        f"{name} · {n} deviations in 30d",
        2,
    )


async def _probe_sage(conn: psycopg.AsyncConnection) -> Finding:
    rows = await _q(
        conn,
        "SELECT COUNT(*) AS n FROM public.deviations "
        " WHERE severity = 'critical' AND resolved_at IS NULL",
    )
    n = int(rows[0]["n"]) if rows else 0
    if n > 0:
        return Finding(
            "alerting",
            "Alerting",
            f"{n} unresolved critical deviations · audit required",
            5,
        )
    return Finding(
        "idle",
        "Idle",
        "All audit checkpoints green",
        0,
    )


PROBES: list[tuple[str, Probe]] = [
    ("marcus", _probe_marcus),
    ("iris", _probe_iris),
    ("quinn", _probe_quinn),
    ("sasha", _probe_sasha),
    ("mason", _probe_mason),
    ("sage", _probe_sage),
]


# ─── snapshot assembly ───────────────────────────────────────────────────


def _shift_label(d: datetime) -> str:
    h = d.hour
    if 6 <= h < 14:
        return "DAY SHIFT"
    if 14 <= h < 22:
        return "SWING SHIFT"
    return "NIGHT SHIFT"


def _derive_pinned(
    findings: dict[str, Finding],
) -> PinnedIncidentOut | None:
    """Promote the single highest-severity finding to a pinned incident."""
    ranked = sorted(
        findings.items(), key=lambda kv: kv[1].severity, reverse=True
    )
    if not ranked or ranked[0][1].severity < 4:
        return None
    top_id, top = ranked[0]
    converging = [top_id]
    # If a second SME also has a high-severity finding, treat them as
    # converging on the same incident.
    for sid, f in ranked[1:]:
        if f.severity >= 4 and sid != top_id:
            converging.append(sid)
            break
    severity = "critical" if top.severity >= 5 else "warning"
    now = datetime.now(timezone.utc)
    return PinnedIncidentOut(
        id=f"incident-{top_id}-{now.strftime('%Y%m%d%H%M')}",
        severity=severity,
        headline=top.text,
        subtext=(
            " + ".join(c.capitalize() for c in converging)
            + " converging"
        ),
        converging_sme_ids=converging,
        started_at=now.isoformat(),
    )


async def _compute_snapshot() -> SnapshotResponse:
    settings = get_settings()
    findings: dict[str, Finding] = {}
    async with await psycopg.AsyncConnection.connect(settings.source_url) as conn:
        # Autocommit so a failing probe doesn't leave the connection in
        # 'aborted transaction' state — every probe gets a clean slate.
        await conn.set_autocommit(True)
        for sme_id, probe in PROBES:
            try:
                findings[sme_id] = await probe(conn)
            except Exception as e:  # noqa: BLE001
                log.warning("situation_room.probe_failed sme=%s err=%s", sme_id, e)
                findings[sme_id] = Finding(
                    "idle",
                    "Idle",
                    "Probe error · check backend logs",
                    0,
                )

    now = datetime.now(timezone.utc)
    stations = [
        SMEStationOut(
            sme_id=sid,
            status=f.status,
            status_label=f.label,
            current_finding=f.text,
            last_updated=now.isoformat(),
        )
        for sid, f in findings.items()
    ]
    return SnapshotResponse(
        shift_label=_shift_label(now.astimezone()),
        stations=stations,
        pinned_incident=_derive_pinned(findings),
        fetched_at=now.isoformat(),
        source="live",
    )


@router.get("/snapshot", response_model=SnapshotResponse)
async def snapshot() -> SnapshotResponse:
    """Return the current SR snapshot, hitting cache when fresh.

    Memoised for CACHE_TTL_SEC seconds. The lock prevents thundering-herd
    when many tabs open at once."""
    global _cache
    now = time.time()
    if _cache is not None and (now - _cache[0]) < CACHE_TTL_SEC:
        return SnapshotResponse(**_cache[1])

    async with _cache_lock:
        # Re-check after acquiring the lock.
        if _cache is not None and (time.time() - _cache[0]) < CACHE_TTL_SEC:
            return SnapshotResponse(**_cache[1])
        snap = await _compute_snapshot()
        _cache = (time.time(), snap.model_dump())
        return snap
