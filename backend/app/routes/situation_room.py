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
    trail: list[float] | None = None  # 7 daily samples, oldest → newest
    evidence_sql: str | None = None  # the probe SQL behind current_finding
    evidence_row: dict | None = None  # the top row returned by the probe


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
    trail: list[float] | None = None  # 7 daily samples for sparkline
    evidence_sql: str | None = None    # primary probe SQL (receipts)
    evidence_row: dict | None = None   # top row from the probe


Probe = Callable[[psycopg.AsyncConnection], Awaitable[Finding]]


async def _q(conn: psycopg.AsyncConnection, sql: str) -> list[dict[str, Any]]:
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(sql)
        return await cur.fetchall()


def _row_jsonable(r: dict[str, Any]) -> dict[str, Any]:
    """psycopg returns Decimal / datetime / etc. — coerce to JSON-safe."""
    from decimal import Decimal
    out: dict[str, Any] = {}
    for k, v in r.items():
        if v is None or isinstance(v, (str, int, bool)):
            out[k] = v
        elif isinstance(v, float):
            out[k] = round(v, 4)
        elif isinstance(v, Decimal):
            out[k] = round(float(v), 4)
        else:
            out[k] = str(v)
    return out


async def _trail(
    conn: psycopg.AsyncConnection, sql: str, days: int = 7
) -> list[float]:
    """Run a query that returns rows of (day, value) for the last N days,
    fill missing days with 0, return oldest→newest values."""
    rows = await _q(conn, sql)
    by_day: dict[str, float] = {}
    for r in rows:
        d = r.get("day")
        v = r.get("value")
        if d is None or v is None:
            continue
        # Postgres date → ISO string for keying
        key = d.isoformat() if hasattr(d, "isoformat") else str(d)
        try:
            by_day[key] = float(v)
        except (TypeError, ValueError):
            continue
    today = datetime.now(timezone.utc).date()
    out: list[float] = []
    for i in range(days - 1, -1, -1):
        d = today.fromordinal(today.toordinal() - i)
        out.append(by_day.get(d.isoformat(), 0.0))
    return out


async def _probe_marcus(conn: psycopg.AsyncConnection) -> Finding:
    primary_sql = (
        "SELECT line_id, deviation_rate FROM loom_views.v_deviation_rate_by_line_30d "
        "ORDER BY deviation_rate DESC NULLS LAST LIMIT 1"
    )
    rows = await _q(conn, primary_sql)
    # Trail: daily total deviation count, 7 days
    trail = await _trail(
        conn,
        "SELECT date_trunc('day', observed_at)::date AS day, COUNT(*) AS value "
        "  FROM public.deviations "
        " WHERE observed_at >= NOW() - INTERVAL '7 days' "
        " GROUP BY 1",
    )
    if not rows:
        return Finding("idle", "Idle", "No production-run data available", 0, trail, primary_sql, None)
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
            trail,
            primary_sql,
            _row_jsonable(r),
        )
    return Finding(
        "watching",
        "Now watching",
        f"OEE drift across lines · {line} highest at {pct:.1f}%",
        2,
        trail,
        primary_sql,
        _row_jsonable(r),
    )


async def _probe_iris(conn: psycopg.AsyncConnection) -> Finding:
    primary_sql = (
        "SELECT category, COUNT(*) AS n FROM public.deviations "
        "WHERE observed_at >= NOW() - INTERVAL '24 hours' "
        "  AND severity IN ('critical','high') "
        "GROUP BY category ORDER BY n DESC LIMIT 1"
    )
    rows = await _q(conn, primary_sql)
    # Trail: daily critical+high sensor (temperature/pressure/vibration) count
    trail = await _trail(
        conn,
        "SELECT date_trunc('day', observed_at)::date AS day, COUNT(*) AS value "
        "  FROM public.deviations "
        " WHERE observed_at >= NOW() - INTERVAL '7 days' "
        "   AND severity IN ('critical','high') "
        "   AND category IN ('temperature','pressure','vibration') "
        " GROUP BY 1",
    )
    if not rows:
        return Finding(
            "watching",
            "Now watching",
            "No critical sensor events in last 24h",
            1,
            trail,
            primary_sql,
            None,
        )
    cat = (rows[0].get("category") or "anomaly").strip()
    n = int(rows[0].get("n") or 0)
    row_evidence = _row_jsonable(rows[0])
    if n >= 5:
        return Finding(
            "alerting",
            "Alerting",
            f"{cat.capitalize()} anomaly · {n} critical events in last 24h",
            5,
            trail,
            primary_sql,
            row_evidence,
        )
    return Finding(
        "watching",
        "Now watching",
        f"{cat.capitalize()} · {n} elevated events in last 24h",
        2,
        trail,
        primary_sql,
        row_evidence,
    )


async def _probe_quinn(conn: psycopg.AsyncConnection) -> Finding:
    primary_sql = (
        "SELECT parameter, "
        "       COUNT(*) FILTER (WHERE in_spec = false)::float "
        "       / NULLIF(COUNT(*), 0) AS fail_rate, "
        "       COUNT(*) AS total "
        "  FROM public.quality_checks "
        " WHERE checked_at >= NOW() - INTERVAL '7 days' "
        " GROUP BY parameter "
        " HAVING COUNT(*) >= 10 "
        " ORDER BY fail_rate DESC NULLS LAST LIMIT 1"
    )
    rows = await _q(conn, primary_sql)
    # Trail: daily out-of-spec fraction
    trail = await _trail(
        conn,
        "SELECT date_trunc('day', checked_at)::date AS day, "
        "       (COUNT(*) FILTER (WHERE in_spec = false))::float "
        "       / NULLIF(COUNT(*), 0) AS value "
        "  FROM public.quality_checks "
        " WHERE checked_at >= NOW() - INTERVAL '7 days' "
        " GROUP BY 1",
    )
    if not rows:
        return Finding(
            "watching",
            "Now watching",
            "No quality checks in last 7d",
            1,
            trail,
            primary_sql,
            None,
        )
    param = (rows[0].get("parameter") or "parameter").strip()
    rate = float(rows[0].get("fail_rate") or 0)
    row_evidence = _row_jsonable(rows[0])
    if rate > 0.15:
        return Finding(
            "alerting",
            "Alerting",
            f"Quality drift on {param} · {rate*100:.1f}% failure in last 7d",
            4,
            trail,
            primary_sql,
            row_evidence,
        )
    return Finding(
        "watching",
        "Now watching",
        f"{param} · {rate*100:.1f}% failure rate in last 7d",
        2,
        trail,
        primary_sql,
        row_evidence,
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
    primary_sql = (
        "SELECT e.equipment_id, e.name AS equipment_name, COUNT(*) AS n "
        "  FROM public.deviations d "
        "  JOIN public.equipment e ON e.equipment_id = d.equipment_id "
        " WHERE d.observed_at >= NOW() - INTERVAL '30 days' "
        " GROUP BY e.equipment_id, e.name "
        " ORDER BY n DESC LIMIT 1"
    )
    rows = await _q(conn, primary_sql)
    # Trail: total daily deviations across all equipment
    trail = await _trail(
        conn,
        "SELECT date_trunc('day', observed_at)::date AS day, COUNT(*) AS value "
        "  FROM public.deviations "
        " WHERE observed_at >= NOW() - INTERVAL '7 days' "
        " GROUP BY 1",
    )
    if not rows:
        return Finding("idle", "Idle", "No equipment events in last 30d", 0, trail, primary_sql, None)
    name = rows[0].get("equipment_name") or "?"
    n = int(rows[0].get("n") or 0)
    row_evidence = _row_jsonable(rows[0])
    if n >= 20:
        return Finding(
            "recommending",
            "Recommending",
            f"Pull {name} for service · {n} deviations in 30d",
            4,
            trail,
            primary_sql,
            row_evidence,
        )
    return Finding(
        "watching",
        "Now watching",
        f"{name} · {n} deviations in 30d",
        2,
        trail,
        primary_sql,
        row_evidence,
    )


async def _probe_sage(conn: psycopg.AsyncConnection) -> Finding:
    primary_sql = (
        "SELECT COUNT(*) AS n FROM public.deviations "
        " WHERE severity = 'critical' AND resolved_at IS NULL"
    )
    rows = await _q(conn, primary_sql)
    # Trail: daily count of new critical deviations
    trail = await _trail(
        conn,
        "SELECT date_trunc('day', observed_at)::date AS day, COUNT(*) AS value "
        "  FROM public.deviations "
        " WHERE observed_at >= NOW() - INTERVAL '7 days' "
        "   AND severity = 'critical' "
        " GROUP BY 1",
    )
    n = int(rows[0]["n"]) if rows else 0
    row_evidence = _row_jsonable(rows[0]) if rows else None
    if n > 0:
        return Finding(
            "alerting",
            "Alerting",
            f"{n} unresolved critical deviations · audit required",
            5,
            trail,
            primary_sql,
            row_evidence,
        )
    return Finding(
        "idle",
        "Idle",
        "All audit checkpoints green",
        0,
        trail,
        primary_sql,
        row_evidence,
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


async def _user_persona_ids() -> list[str]:
    """User-created personas (rows in sme_personas). They have no probe yet,
    so we emit a 'watching · awaiting probe' finding so they appear on the
    SR and can be taught."""
    from app.db import get_conn  # local import to avoid cycle
    try:
        async with get_conn() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT id FROM sme_personas WHERE enabled = TRUE",
                )
                rows = await cur.fetchall()
        return [r[0] for r in rows]
    except Exception as e:  # noqa: BLE001
        log.warning("situation_room.persona_list_failed err=%s", e)
        return []


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

    # Append user-created personas (no probe — they sit in watching state
    # until teach notes accumulate and/or a probe is bound).
    for pid in await _user_persona_ids():
        findings[pid] = Finding(
            "watching",
            "Now watching",
            "Awaiting probe · teach me what to look for",
            1,
        )

    now = datetime.now(timezone.utc)
    stations = [
        SMEStationOut(
            sme_id=sid,
            status=f.status,
            status_label=f.label,
            current_finding=f.text,
            last_updated=now.isoformat(),
            trail=f.trail,
            evidence_sql=f.evidence_sql,
            evidence_row=f.evidence_row,
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
