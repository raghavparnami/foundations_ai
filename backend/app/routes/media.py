"""Charts + reports + presentations download routes.

Ports:
    src/app/api/charts/[slug]/route.ts
    src/app/api/reports/route.ts
    src/app/api/reports/[slug]/download/route.ts
    src/app/api/presentations/[slug]/download/route.ts

Generation of these artifacts is done by agent tools (generate_chart,
generate_report, generate_presentation) which come in a later chunk; these
endpoints are read/download only.
"""
from __future__ import annotations

import base64
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from psycopg.rows import dict_row

from app.db import get_conn

charts_router = APIRouter()
reports_router = APIRouter()
presentations_router = APIRouter()


@charts_router.get("/{slug}")
async def get_chart(slug: str) -> dict[str, Any]:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                "SELECT slug, title, spec FROM charts WHERE slug = %s", (slug,)
            )
            row = await cur.fetchone()
    if not row:
        raise HTTPException(404, detail="not_found")
    return {"chart": row}


@reports_router.get("")
async def list_reports() -> dict[str, list[dict[str, Any]]]:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT id, slug, title, conversation_id, created_at,
                       length(body_md)::int AS bytes
                  FROM reports
                 ORDER BY created_at DESC
                 LIMIT 50
                """
            )
            return {"reports": await cur.fetchall()}


@reports_router.get("/{slug}/download")
async def download_report(slug: str) -> Response:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                "SELECT title, body_md FROM reports WHERE slug = %s", (slug,)
            )
            row = await cur.fetchone()
    if not row:
        return Response("not found", status_code=404)
    return Response(
        row["body_md"],
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{slug}.md"'},
    )


@presentations_router.get("/{slug}/download")
async def download_presentation(slug: str) -> Response:
    filename = slug if slug.endswith(".pptx") else f"{slug}.pptx"
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                "SELECT title, body_md FROM reports WHERE slug = %s", (filename,)
            )
            row = await cur.fetchone()
    if not row:
        return Response("not found", status_code=404)
    binary = base64.b64decode(row["body_md"])
    return Response(
        binary,
        media_type=(
            "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        ),
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(binary)),
        },
    )
