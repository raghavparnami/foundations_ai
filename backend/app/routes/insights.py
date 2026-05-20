"""Insights endpoint — persisted rows + view-derived fallback.

Port of src/app/api/insights/route.ts. POST /api/insights/refresh comes once
the insights worker is ported; until then it returns 501.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import psycopg
from fastapi import APIRouter, HTTPException
from psycopg.rows import dict_row

from app.config import get_settings
from app.db import get_conn

router = APIRouter()


@router.get("")
async def list_route() -> dict[str, list[dict[str, Any]]]:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT id, view_slug, headline, body, importance,
                       created_at::text AS created_at
                  FROM insights
                 ORDER BY importance DESC, created_at DESC
                 LIMIT 8
                """
            )
            persisted = await cur.fetchall()
    if persisted:
        return {"insights": persisted}
    return {"insights": await _derive_from_views()}


@router.post("/refresh")
async def refresh_route() -> dict[str, Any]:
    raise HTTPException(
        501,
        detail=(
            "Insights worker not ported yet. The legacy Next.js scheduler on :3001 "
            "still writes to the same `insights` table; this read endpoint will surface "
            "whatever it produced."
        ),
    )


async def _derive_from_views() -> list[dict[str, Any]]:
    """Cheap fallback: synthesize headlines from saved views row counts."""
    settings = get_settings()
    out: list[dict[str, Any]] = []
    now = datetime.now(timezone.utc).isoformat()
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT name, description
                  FROM proposals
                 WHERE kind = 'view' AND status = 'applied'
                 ORDER BY created_at DESC
                 LIMIT 6
                """
            )
            views = await cur.fetchall()
    if not views:
        return []
    try:
        async with await psycopg.AsyncConnection.connect(settings.source_url) as src:
            for i, v in enumerate(views):
                try:
                    async with src.cursor() as cur:
                        await cur.execute(f'SELECT count(*)::int FROM "loom_views"."{v["name"]}"')
                        row = await cur.fetchone()
                    rows_n = int(row[0]) if row else 0
                except psycopg.Error:
                    rows_n = 0
                out.append({
                    "id": -1 - i,
                    "view_slug": v["name"],
                    "headline": f"View `{v['name']}` exposes {rows_n} rows.",
                    "body": v["description"],
                    "importance": 1,
                    "created_at": now,
                })
    except Exception:  # noqa: BLE001
        return out
    return out
