"""Continuous re-enrichment scheduler.

Slim port of src/lib/worker/scheduler.ts. Every TICK_SECONDS the scheduler
runs Loop 1 in delta mode for each active source, then Loop 2 over any
dirty tables. The TS app also runs Loop 3/4 + wiki agents in the same tick;
those ports come in later chunks.

Single asyncio.Task held in process-wide state — re-calling start() is a
no-op, matching the Node-side guard pattern.
"""
from __future__ import annotations

import asyncio
import logging
import time

from ..db import get_conn
from .loop1 import run_loop1
from .loop2 import run_loop2_for_tables

log = logging.getLogger(__name__)

TICK_SECONDS = 60
MIN_GAP_PER_TABLE_S = 90

_task: asyncio.Task[None] | None = None
_busy = False
_last_enriched: dict[int, float] = {}


def start_scheduler() -> bool:
    """Idempotent — returns True only on the call that actually started it."""
    global _task
    if _task is not None and not _task.done():
        return False
    _task = asyncio.create_task(_run_forever(), name="loom-scheduler")
    log.info("scheduler.started interval_s=%s", TICK_SECONDS)
    return True


async def stop_scheduler() -> None:
    global _task
    if _task is None:
        return
    _task.cancel()
    try:
        await _task
    except (asyncio.CancelledError, Exception):  # noqa: BLE001
        pass
    _task = None
    log.info("scheduler.stopped")


async def _run_forever() -> None:
    while True:
        try:
            await _tick()
        except Exception as e:  # noqa: BLE001
            log.error("scheduler.tick_failed err=%s", e)
        try:
            await asyncio.sleep(TICK_SECONDS)
        except asyncio.CancelledError:
            return


async def _tick() -> None:
    global _busy
    if _busy:
        return
    _busy = True
    try:
        sources = await _active_sources()
        for sid, name, conn_url in sources:
            try:
                result = await run_loop1(sid, conn_url, schema="public", mode="delta")
                now = time.monotonic()
                eligible: list[int] = []
                for tid in result.dirty:
                    last = _last_enriched.get(tid, 0.0)
                    if now - last >= MIN_GAP_PER_TABLE_S:
                        eligible.append(tid)
                        _last_enriched[tid] = now
                if eligible:
                    await run_loop2_for_tables(conn_url, eligible)
            except Exception as e:  # noqa: BLE001
                log.warning("scheduler.source_tick_failed source=%s err=%s", name, e)
    finally:
        _busy = False


async def _active_sources() -> list[tuple[int, str, str]]:
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT id, name, conn_url FROM sources WHERE kind = 'postgres'"
            )
            rows = await cur.fetchall()
    return [(int(r[0]), str(r[1]), str(r[2])) for r in rows]
