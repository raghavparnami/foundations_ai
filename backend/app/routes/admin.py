"""Admin operations the user kicks manually — not auto-scheduled.

Currently exposes:
  POST /api/admin/regenerate-docs
       Flip every table to status='profiled' and re-run Loop 2 against the
       configured source DB. Used after a template upgrade so existing
       enriched docs get the new format. Then re-emit the tables wiki so
       the markdown shown in the wiki UI reflects the new doc.
"""
from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter
from pydantic import BaseModel

from app.audit import audit
from app.config import get_settings
from app.db import get_conn
from app.workers.loop2 import run_loop2_force_all
from app.workers.wiki.tables import run_tables_wiki_agent

log = logging.getLogger(__name__)
router = APIRouter()

_regen_running = False


class RegenerateResponse(BaseModel):
    status: str
    tables_total: int = 0
    note: str | None = None


@router.post("/regenerate-docs", response_model=RegenerateResponse)
async def regenerate_docs() -> RegenerateResponse:
    """Kick a full re-enrichment of every table doc, then refresh wiki pages.

    Idempotent and slow (one LLM call per table) — runs as a background task
    so the request returns immediately. Concurrent calls are coalesced via
    a process-local guard.
    """
    global _regen_running

    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute("SELECT count(*) FROM tables")
            row = await cur.fetchone()
    total = int(row[0]) if row else 0

    if _regen_running:
        return RegenerateResponse(
            status="already_running",
            tables_total=total,
            note="A regeneration is already in flight.",
        )

    _regen_running = True
    settings = get_settings()

    async def _bg() -> None:
        global _regen_running
        try:
            await audit("admin", "regenerate-docs:start", None, {"tables": total})
            done = await run_loop2_force_all(settings.source_url)
            wiki_stats = await run_tables_wiki_agent()
            await audit(
                "admin",
                "regenerate-docs:done",
                None,
                {"tables_done": done, "wiki": wiki_stats},
            )
        except Exception as e:  # noqa: BLE001
            log.error("admin.regenerate_docs.failed err=%s", e)
            await audit(
                "admin",
                "regenerate-docs:failed",
                None,
                {"err": str(e)[:300]},
            )
        finally:
            _regen_running = False

    asyncio.create_task(_bg(), name="loom-regen-docs")
    return RegenerateResponse(
        status="kicked",
        tables_total=total,
        note=f"Re-enriching {total} tables in background — takes ~10s per table.",
    )
