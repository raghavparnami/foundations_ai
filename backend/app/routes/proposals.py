"""Proposals (views, metrics, doc updates) list route.

Port of src/app/api/proposals/route.ts. Per-proposal actions live elsewhere
(views/[slug] for view edit + delete; doc updates are inline). This is the
read endpoint that powers the proposals page.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from psycopg.rows import dict_row

from app.db import get_conn

router = APIRouter()


@router.get("")
async def list_route() -> dict[str, list[dict[str, Any]]]:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT id, kind, name, description, sql, status, created_at
                  FROM proposals
                 ORDER BY created_at DESC
                 LIMIT 50
                """
            )
            return {"proposals": await cur.fetchall()}
