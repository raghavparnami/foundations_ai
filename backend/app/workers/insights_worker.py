"""Insights extractor.

Port of src/lib/worker/insights.ts. For each saved view that doesn't yet
have insights, sample 25 rows and ask the doc-writer for 1-3 short findings,
saved into the ``insights`` table. The scheduler calls this; the chat
upper-right panel renders the results.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

import psycopg
from psycopg.rows import dict_row
from pydantic import BaseModel, Field, ValidationError

from ..audit import audit
from ..config import get_settings
from ..db import get_conn
from ..llm import async_client, chat_model_id

log = logging.getLogger(__name__)


class _Finding(BaseModel):
    headline: str = Field(min_length=10, max_length=120)
    body: str | None = Field(default=None, max_length=280)
    importance: int = Field(ge=1, le=5)


class _Payload(BaseModel):
    findings: list[_Finding] = Field(min_length=1, max_length=3)


async def extract_insights_for_view(view_slug: str) -> dict[str, Any]:
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT count(*)::int FROM insights WHERE view_slug = %s", (view_slug,)
            )
            row = await cur.fetchone()
    if row and int(row[0]) > 0:
        return {"ok": True, "inserted": 0}

    settings = get_settings()
    try:
        async with await psycopg.AsyncConnection.connect(settings.source_url) as src:
            async with src.cursor(row_factory=dict_row) as cur:
                await cur.execute(f'SELECT * FROM "loom_views"."{view_slug}" LIMIT 25')
                sample = await cur.fetchall()
                columns = [d.name for d in cur.description or []]
    except psycopg.Error as e:
        return {"ok": False, "inserted": 0, "error": f"Failed to read view: {e}"}
    if not sample:
        return {"ok": True, "inserted": 0}

    prompt = "\n".join([
        f"You are extracting analyst-grade findings from a Postgres view called `loom_views.{view_slug}`.",
        "",
        f"Columns: {', '.join(columns)}",
        "",
        "Sample rows (JSON):",
        "```json",
        json.dumps(sample, default=_default, indent=2)[:8000],
        "```",
        "",
        "Surface 1-3 SHORT, factual findings an exec would care about.",
        "Rules:",
        "- Headline: a single sentence, present tense, with the specific number.",
        "  Examples: 'LINE-B has the highest deviation rate at 78%.'",
        "- Body (optional): one sentence with supporting numbers or context.",
        "- importance 1=trivia, 3=worth knowing, 5=urgent.",
        "- Do NOT invent. If the data doesn't support a finding, omit it.",
        "- Do NOT recommend actions. Just observations.",
        "",
        'Return JSON: {"findings": [{"headline": "...", "body": "...", "importance": 1-5}, ...]}',
    ])

    try:
        resp = await async_client().chat.completions.create(
            model=chat_model_id(),
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.2,
        )
        raw = (resp.choices[0].message.content or "{}") if resp.choices else "{}"
        payload = _Payload.model_validate_json(raw)
    except (ValidationError, json.JSONDecodeError, Exception) as e:  # noqa: BLE001
        log.warning("insights.llm_failed view=%s err=%s", view_slug, e)
        return {"ok": False, "inserted": 0, "error": str(e)}

    inserted = 0
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            for f in payload.findings:
                await cur.execute(
                    """
                    INSERT INTO insights (view_slug, headline, body, importance)
                         VALUES (%s, %s, %s, %s)
                    ON CONFLICT (view_slug, headline) DO UPDATE
                      SET body = COALESCE(EXCLUDED.body, insights.body),
                          importance = GREATEST(insights.importance, EXCLUDED.importance)
                    RETURNING id
                    """,
                    (view_slug, f.headline.strip(), (f.body or "").strip() or None, f.importance),
                )
                if await cur.fetchone():
                    inserted += 1
    await audit("worker:insights", "extract", f"loom_views.{view_slug}", {"findings": inserted})
    log.info("insights.extracted view=%s n=%s", view_slug, inserted)
    return {"ok": True, "inserted": inserted}


async def extract_insights_for_missing_views() -> dict[str, int]:
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT name FROM proposals WHERE kind = 'view' AND status = 'applied'"
            )
            views = await cur.fetchall()
    extracted = 0
    for (name,) in views:
        try:
            r = await extract_insights_for_view(name)
            if r.get("ok") and r.get("inserted", 0) > 0:
                extracted += int(r["inserted"])
        except Exception as e:  # noqa: BLE001
            log.warning("insights.view_failed view=%s err=%s", name, e)
    return {"scanned": len(views), "extracted": extracted}


def _default(v: Any) -> Any:
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, (bytes, bytearray)):
        return v.decode("utf-8", errors="replace")
    return str(v)
