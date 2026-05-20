"""Wiki runner — orchestrates the three corpus agents.

Each agent (tables / docs / code) runs on its own cadence and via its own
soft lock in ``wiki_agent_state``. They run concurrently; if a previous tick
is still running for an agent, this tick skips that agent.

Per-agent cadences (mirroring src/lib/worker/wiki/runner.ts):
  tables  — every tick (cheap, hash-gated)
  docs    — every tick + on upload
  code    — every 5 min + on repo register/refresh

After per-corpus ingestion: discover_domains() re-clusters source pages into
named domains, then run_domain_index_builder() synthesizes the one-per-domain
landing page.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Callable, Coroutine

from ...catalog.wiki import begin_agent_tick, end_agent_tick
from .code import run_code_wiki_agent
from .docs import run_docs_wiki_agent
from .domain_index import run_domain_index_builder
from .domains import discover_domains
from .tables import run_tables_wiki_agent

log = logging.getLogger(__name__)

CODE_INTERVAL_S = 5 * 60
_last_code_run_at: float = 0.0


AgentFn = Callable[[], Coroutine[None, None, dict[str, int]]]


async def run_all_wiki_agents(*, code_always: bool = False) -> None:
    """One tick across all three corpus agents + domain discovery + domain index."""
    # 1. Per-corpus ingestion in parallel.
    async def _code_branch() -> None:
        global _last_code_run_at
        now = time.monotonic()
        if code_always or now - _last_code_run_at >= CODE_INTERVAL_S:
            _last_code_run_at = now
            await _run_one_agent("code", run_code_wiki_agent)

    await asyncio.gather(
        _run_one_agent("tables", run_tables_wiki_agent),
        _run_one_agent("docs", run_docs_wiki_agent),
        _code_branch(),
        return_exceptions=True,
    )

    # 2. Domain discovery — re-clusters source pages. Hash-gated.
    try:
        await discover_domains()
    except Exception as e:  # noqa: BLE001
        log.warning("wiki.domain_discovery.failed err=%s", e)

    # 3. Domain index builder — landing page per domain.
    try:
        await run_domain_index_builder()
    except Exception as e:  # noqa: BLE001
        log.warning("wiki.domain_index.failed err=%s", e)


async def _run_one_agent(kind: str, fn: AgentFn) -> None:
    claimed = await begin_agent_tick(kind)  # type: ignore[arg-type]
    if not claimed:
        return
    started = time.monotonic()
    try:
        out = await fn()
        generated = int(out.get("generated", 0))
        await end_agent_tick(kind, "ok", generated)  # type: ignore[arg-type]
        log.info("wiki.%s.done generated=%s ms=%s",
                 kind, generated, int((time.monotonic() - started) * 1000))
    except Exception as e:  # noqa: BLE001
        await end_agent_tick(kind, "failed", 0, str(e))  # type: ignore[arg-type]
        log.error("wiki.%s.failed err=%s ms=%s",
                  kind, e, int((time.monotonic() - started) * 1000))


# ─── Targeted single-agent runs for API-driven triggers ──────────────────


async def run_tables_wiki() -> None:
    await _run_one_agent("tables", run_tables_wiki_agent)


async def run_docs_wiki() -> None:
    await _run_one_agent("docs", run_docs_wiki_agent)


async def run_code_wiki() -> None:
    await _run_one_agent("code", run_code_wiki_agent)
