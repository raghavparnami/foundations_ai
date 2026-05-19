/**
 * Continuous re-enrichment scheduler. Once started (idempotently), it ticks
 * every TICK_MS milliseconds, runs Loop 1 in `delta` mode against every
 * source, and feeds any changed tables into Loop 2.
 *
 * Guard pattern: a single setInterval is stashed on globalThis so Next.js
 * hot reload doesn't spawn duplicates.
 *
 * The scheduler is the practical implementation of CLAUDE.md's "Loom is
 * always preparing" property — docs stay fresh as columns are added,
 * removed, or query patterns shift.
 */
import { catalogPool, sourcePool } from "../catalog/db";
import { runLoop1 } from "./loop1";
import { runLoop2ForTables } from "./loop2";
import { seedViewsForSource } from "./loop4-seed-views";
import { runAllWikiAgents } from "./wiki/runner";
import { runLoop3 } from "./loop3";
import { runEmbedBackfill } from "./embed-backfill";
import { audit } from "../catalog/queries";
import { log } from "../shared/log";

const TICK_MS = 60_000;        // 60s — slow enough to be cheap, fast enough to feel live
const MIN_GAP_PER_TABLE_MS = 90_000; // never re-enrich the same table more than ~once / 1.5 min
const WIKI_INTERVAL_MS = 24 * 60 * 60_000; // 24h — wiki regeneration is LLM-heavy (docs/code/domain agents call the doc-writer model)

declare global {
  var __loomSchedulerHandle: NodeJS.Timeout | undefined;
  var __loomSchedulerBusy: boolean | undefined;
  var __loomLastEnriched: Map<number, number> | undefined;
  var __loomLastWikiRunAt: number | undefined;
}

export function startScheduler(): { started: boolean; intervalMs: number } {
  if (globalThis.__loomSchedulerHandle) {
    return { started: false, intervalMs: TICK_MS };
  }
  globalThis.__loomLastEnriched ??= new Map();
  globalThis.__loomSchedulerHandle = setInterval(() => {
    void tickOnce().catch((e) => log.error("scheduler.tick_failed", { err: String(e) }));
  }, TICK_MS);
  log.info("scheduler.started", { intervalMs: TICK_MS });
  return { started: true, intervalMs: TICK_MS };
}

export function stopScheduler(): void {
  if (globalThis.__loomSchedulerHandle) {
    clearInterval(globalThis.__loomSchedulerHandle);
    globalThis.__loomSchedulerHandle = undefined;
    log.info("scheduler.stopped");
  }
}

async function tickOnce(): Promise<void> {
  if (globalThis.__loomSchedulerBusy) return;
  globalThis.__loomSchedulerBusy = true;
  try {
    // Active sources only (kind=postgres in v0.1 — other connectors are
    // recorded but not yet polled)
    const sources = await catalogPool.query<{ id: number; name: string; kind: string; conn_url: string }>(
      `SELECT id, name, kind, conn_url FROM sources WHERE kind = 'postgres'`,
    );
    for (const s of sources.rows) {
      try {
        const pool = sourcePool(s.conn_url);
        const { dirty } = await runLoop1(s.id, pool, "public", "delta");

        // Filter to tables that haven't been enriched too recently
        const now = Date.now();
        const eligible: number[] = [];
        const lastMap = globalThis.__loomLastEnriched!;
        for (const id of dirty) {
          const last = lastMap.get(id) ?? 0;
          if (now - last >= MIN_GAP_PER_TABLE_MS) {
            eligible.push(id);
            lastMap.set(id, now);
          }
        }
        if (eligible.length > 0) {
          await audit("system", "scheduler:reenrich", s.name, { tables: eligible.length });
          await runLoop2ForTables(s.conn_url, eligible);
        }

        // Loop 4 — proactive view seeding. Idempotent (no-ops if any
        // loom_views.* already exist for this source). Triggers naturally
        // the first time a source becomes "ready", and again when a fresh
        // demo:reset wipes views without wiping source data.
        try {
          await seedViewsForSource(s.id);
        } catch (e) {
          log.warn("scheduler.seed_failed", { source: s.name, err: String(e) });
        }
      } catch (e) {
        log.warn("scheduler.source_tick_failed", { source: s.name, err: String(e) });
      }
    }

    // Loop 3 — relationship discovery. Mines audit_log globally (not per
    // source), so it runs once per tick outside the source loop. Cheap when
    // there's nothing new: FK backfill is a no-op after the first run, and
    // observed-join mining only re-parses SQL from the last 24h.
    try {
      await runLoop3();
    } catch (e) {
      log.warn("scheduler.loop3_failed", { err: String(e) });
    }

    // Embedding backfill — embed any table doc or wiki page whose content
    // hash changed since the last embed. Batched (64 per tick) to keep API
    // spend bounded; full backfill of a 10K-table catalog takes ~160 ticks
    // (~3h) but is incremental, so it never blocks anything else.
    try {
      await runEmbedBackfill();
    } catch (e) {
      log.warn("scheduler.embed_backfill_failed", { err: String(e) });
    }

    // Wiki agents run at most once per day — docs/code/domain agents call
    // the doc-writer LLM, so even hash-gated they add up over many ticks.
    // On-demand paths bypass this (upload → docs agent, /api/wiki/code-sources
    // → code agent, /api/wiki/discover-domains → domains) so users can force
    // a refresh without waiting for the daily window.
    const now = Date.now();
    const lastWiki = globalThis.__loomLastWikiRunAt ?? 0;
    if (now - lastWiki >= WIKI_INTERVAL_MS) {
      globalThis.__loomLastWikiRunAt = now;
      try {
        await runAllWikiAgents();
      } catch (e) {
        log.warn("scheduler.wiki_failed", { err: String(e) });
      }
    }
  } finally {
    globalThis.__loomSchedulerBusy = false;
  }
}
