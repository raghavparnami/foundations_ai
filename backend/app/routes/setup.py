"""Boot endpoint — idempotent setup the React shell hits on mount.

Mirrors the Next.js /api/ensure-setup route. Starts the scheduler (once),
checks whether the demo source has any profiled tables, and if not kicks an
initial Loop 1 → Loop 2 in the background.
"""
from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter
from pydantic import BaseModel

from app.audit import audit
from app.config import get_settings
from app.db import get_conn
from app.workers.loop1 import ensure_source, run_loop1
from app.workers.loop2 import run_loop2_all
from app.workers.scheduler import start_scheduler

log = logging.getLogger(__name__)
router = APIRouter()

_SOURCE_NAME = "factory_demo"
_kicked = False


class EnsureSetupResponse(BaseModel):
    status: str
    source_id: int | None = None
    ready: int = 0
    total: int = 0


@router.post("", response_model=EnsureSetupResponse)
async def ensure_setup() -> EnsureSetupResponse:
    global _kicked
    settings = get_settings()
    start_scheduler()

    source_id = await ensure_source(_SOURCE_NAME, "postgres", settings.source_url)

    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT
                  count(*) FILTER (WHERE status = 'ready')::int,
                  count(*)::int
                FROM tables WHERE source_id = %s
                """,
                (source_id,),
            )
            row = await cur.fetchone()
    ready = int(row[0]) if row else 0
    total = int(row[1]) if row else 0

    if total > 0 and ready == total:
        _kicked = True
        return EnsureSetupResponse(status="already_ready", source_id=source_id, ready=ready, total=total)
    if total == 0:
        _kicked = False
    if _kicked:
        return EnsureSetupResponse(status="already_started", source_id=source_id, ready=ready, total=total)

    _kicked = True
    await audit("system", "boot:ensure_source", _SOURCE_NAME, {"source_id": source_id})

    async def _bg() -> None:
        global _kicked
        try:
            await run_loop1(source_id, settings.source_url, schema="public", mode="full")
            await run_loop2_all(settings.source_url)
            await audit("system", "boot:done", _SOURCE_NAME, {})
        except Exception as e:  # noqa: BLE001
            log.error("boot.failed err=%s", e)
            _kicked = False
            await audit("system", "boot:failed", _SOURCE_NAME, {"err": str(e)[:200]})

    asyncio.create_task(_bg(), name="loom-boot-loop1-2")
    return EnsureSetupResponse(status="kicked", source_id=source_id, ready=0, total=0)
