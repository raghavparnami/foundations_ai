"""Loop 4 — proactive view seeder.

After Loop 2 enriches every table in a source for the first time, ask the
doc-writer LLM to propose up to N useful aggregate views and apply each via
the same `propose_view()` path the chat agent uses. Idempotent across runs:
a soft per-source cap and a per-source cooldown prevent re-seeding storms.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any

from ..audit import audit
from ..db import get_conn
from ..llm import async_client, chat_model_id

log = logging.getLogger(__name__)

MAX_SEED = 5
COOLDOWN_HOURS = 6
SOFT_CAP_PER_SOURCE = 25

SYSTEM = f"""You are Loom's view seeder. Given the documentation for a set of
related tables in a connected database, propose {MAX_SEED} aggregate views
that any analyst querying this database would commonly want pre-built. Each
view becomes a queryable Postgres object.

Hard rules:
- Use ONLY the tables and columns listed in the docs below. Do not invent
  columns or tables.
- The SQL must be a single SELECT (or WITH ... SELECT) statement. No DDL, no
  DML, no semicolons at the end.
- Aggregate intelligently: rates, counts, totals, top-N, time series. Avoid
  raw row dumps.
- Prefer date-filtered "last 30 days" or weekly time-series views. Use
  PostgreSQL date arithmetic (e.g. `NOW() - INTERVAL '30 days'`,
  `DATE_TRUNC('week', column)`).
- Cross-table joins are welcome where FKs make them natural.
- View names: snake_case, descriptive, end with a time-range suffix when
  relevant (e.g. `deviation_rate_by_line_30d`,
  `top_equipment_by_severity_90d`, `weekly_production_trend`).

Return JSON with shape:
{{
  "views": [
    {{"name": "...", "description": "...", "sql": "SELECT ...", "reason": "..."}}
  ]
}}

Return exactly {MAX_SEED} views. `name` must be 3–60 chars snake_case (no
`v_` prefix; the system adds one). `description` 10–220 chars. `reason` ≤140
chars."""


async def seed_views_for_source(source_id: int) -> dict[str, Any]:
    """Propose + apply seed views for one source. Returns a result dict."""
    # 1. Per-source soft cap: stop proactive seeding above N existing views.
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT count(*)::int
                  FROM tables
                 WHERE source_id = %s AND schema_name = 'loom_views'
                """,
                (source_id,),
            )
            row = await cur.fetchone()
    existing_count = int(row[0]) if row else 0
    if existing_count >= SOFT_CAP_PER_SOURCE:
        return {
            "proposed": 0,
            "created": 0,
            "skipped": True,
            "reason": f"soft_cap ({existing_count}>={SOFT_CAP_PER_SOURCE})",
        }

    # 2. Cooldown: don't re-run for the same source within COOLDOWN_HOURS.
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT ts
                  FROM audit_log
                 WHERE actor = 'worker:loop4'
                   AND action IN ('seed_complete','seed_failed')
                   AND (details->>'sourceId')::int = %s
                 ORDER BY ts DESC LIMIT 1
                """,
                (source_id,),
            )
            last_row = await cur.fetchone()
    if last_row and last_row[0] is not None:
        ts = last_row[0]
        if isinstance(ts, datetime):
            last_ts = ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
        else:
            last_ts = datetime.fromisoformat(str(ts))
        age_h = (datetime.now(timezone.utc) - last_ts).total_seconds() / 3600.0
        if age_h < COOLDOWN_HOURS:
            remaining = COOLDOWN_HOURS - age_h
            return {
                "proposed": 0,
                "created": 0,
                "skipped": True,
                "reason": f"cooldown ({remaining:.1f}h remaining)",
            }

    # 3. Gather table docs for this source (base tables, ready status).
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT t.schema_name, t.table_name, d.markdown
                  FROM tables t
                  LEFT JOIN docs d ON d.table_id = t.id
                 WHERE t.source_id = %s
                   AND t.schema_name <> 'loom_views'
                   AND t.status = 'ready'
                 ORDER BY t.table_name
                """,
                (source_id,),
            )
            table_rows = await cur.fetchall()

    if not table_rows:
        return {
            "proposed": 0,
            "created": 0,
            "skipped": True,
            "reason": "no_ready_tables",
        }

    log.info("loop4.start source_id=%s tables=%s", source_id, len(table_rows))

    doc_blocks: list[str] = []
    for schema_name, table_name, markdown in table_rows:
        md = (markdown or "")[:4000]
        doc_blocks.append(f"# `{schema_name}.{table_name}`\n\n{md}")

    user_msg = "\n".join(
        [
            "## Connected tables (with generated docs)",
            "",
            "\n\n---\n\n".join(doc_blocks),
            "",
            "## Task",
            (
                f"Propose {MAX_SEED} aggregate views the analysts on this database "
                "would benefit from. Return JSON matching the schema."
            ),
        ]
    )

    # 4. Ask the doc-writer for structured JSON output.
    client = async_client()
    try:
        resp = await client.chat.completions.create(
            model=chat_model_id(),
            messages=[
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.4,
            response_format={"type": "json_object"},
        )
        raw = (resp.choices[0].message.content or "").strip() if resp.choices else ""
        parsed = _parse_seed_payload(raw)
    except Exception as e:  # noqa: BLE001
        log.error("loop4.generate_failed source_id=%s err=%s", source_id, e)
        await audit(
            "worker:loop4",
            "seed_failed",
            None,
            {"sourceId": source_id, "err": str(e)[:200]},
        )
        return {"proposed": 0, "created": 0, "skipped": True, "reason": "llm_failed"}

    if not parsed:
        await audit(
            "worker:loop4",
            "seed_failed",
            None,
            {"sourceId": source_id, "err": "no_views_parsed"},
        )
        return {"proposed": 0, "created": 0, "skipped": True, "reason": "llm_failed"}

    # 5. Skip names already proposed so we don't churn the proposals table.
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute("SELECT name FROM proposals WHERE kind = 'view'")
            existing_names = await cur.fetchall()
    existing = {re.sub(r"^v_", "", n) for (n,) in existing_names if n}

    # Lazy-imported so the module still parses if the parallel agent hasn't
    # shipped propose_view yet.
    from app.agent.propose_view import propose_view  # noqa: PLC0415

    created = 0
    skipped_dupe = 0
    for v in parsed:
        bare = re.sub(r"^v_", "", v["name"])
        if bare in existing:
            skipped_dupe += 1
            continue
        try:
            description = (
                f"{v['description']} (auto-seeded by Loom. Reason: {v['reason']})"
            )
            r = await propose_view(
                name=v["name"], sql=v["sql"], description=description
            )
            if r.get("ok"):
                created += 1
                await audit(
                    "worker:loop4",
                    "seed_view",
                    str(r.get("qualified_name", v["name"])),
                    {"sourceId": source_id, "reason": v["reason"]},
                )
            else:
                err = str(r.get("error", "")).strip()[:200]
                await audit(
                    "worker:loop4",
                    "seed_view_rejected",
                    v["name"],
                    {"sourceId": source_id, "error": err},
                )
                log.warning("loop4.view_rejected name=%s error=%s", v["name"], err)
        except Exception as e:  # noqa: BLE001
            log.warning("loop4.view_failed name=%s err=%s", v["name"], e)

    log.info(
        "loop4.done source_id=%s proposed=%s created=%s skipped_dupe=%s",
        source_id,
        len(parsed),
        created,
        skipped_dupe,
    )
    await audit(
        "worker:loop4",
        "seed_complete",
        None,
        {
            "sourceId": source_id,
            "proposed": len(parsed),
            "created": created,
            "skipped_dupe": skipped_dupe,
            "existing_at_start": existing_count,
        },
    )
    return {"proposed": len(parsed), "created": created, "skipped": False}


def _parse_seed_payload(raw: str) -> list[dict[str, str]]:
    """Parse + validate the doc-writer's JSON. Tolerates ```json fences."""
    if not raw:
        return []
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```\s*$", "", text)
    try:
        obj = json.loads(text)
    except json.JSONDecodeError:
        return []
    views_raw = obj.get("views") if isinstance(obj, dict) else None
    if not isinstance(views_raw, list):
        return []

    out: list[dict[str, str]] = []
    for v in views_raw[:MAX_SEED]:
        if not isinstance(v, dict):
            continue
        name = str(v.get("name", "")).strip()
        sql = str(v.get("sql", "")).strip()
        description = str(v.get("description", "")).strip()
        reason = str(v.get("reason", "")).strip()
        if not (3 <= len(name) <= 60):
            continue
        if not (10 <= len(description) <= 220):
            continue
        if len(sql) < 20:
            continue
        if len(reason) > 140:
            reason = reason[:140]
        out.append(
            {"name": name, "sql": sql, "description": description, "reason": reason}
        )
    return out
