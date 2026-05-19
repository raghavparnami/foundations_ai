/**
 * Idempotent boot endpoint. The home page hits this on mount.
 *  - Ensures a `factory_demo` source row exists
 *  - Kicks Loop 1 if no tables profiled yet
 *  - Once Loop 1 is done, kicks Loop 2 (semantic enrichment)
 *
 * Loop 1 and Loop 2 run in the background and stream progress through the
 * audit log. The endpoint returns immediately after deciding whether to kick.
 */
import { NextResponse } from "next/server";
import { catalogPool, sourcePool } from "@/lib/catalog/db";
import { ensureSource, runLoop1 } from "@/lib/worker/loop1";
import { runLoop2All } from "@/lib/worker/loop2";
import { seedViewsForSource } from "@/lib/worker/loop4-seed-views";
import { startScheduler } from "@/lib/worker/scheduler";
import { audit } from "@/lib/catalog/queries";
import { log } from "@/lib/shared/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCE_URL =
  process.env.LOOM_DEMO_SOURCE_URL ??
  "postgres://loom:loom@localhost:5544/loom_demo_source";
const SOURCE_NAME = "factory_demo";

declare global {
  var __loomBootKicked: boolean | undefined;
}

export async function POST() {
  // Continuous re-enrichment scheduler — idempotent. Once started, it
  // re-polls every source every 60s and re-enriches changed tables.
  startScheduler();

  // Always check the DB first — the in-memory flag can be stale (page
  // refresh after `demo:reset`, or stuck `true` from a previous run).
  const sourceId = await ensureSource(SOURCE_NAME, "postgres", SOURCE_URL);
  const r = await catalogPool.query<{ ready: string; total: string }>(
    `SELECT
       count(*) FILTER (WHERE status = 'ready')::text AS ready,
       count(*)::text AS total
     FROM tables WHERE source_id = $1`,
    [sourceId]
  );
  const ready = Number(r.rows[0]?.ready ?? 0);
  const total = Number(r.rows[0]?.total ?? 0);
  if (total > 0 && ready === total) {
    globalThis.__loomBootKicked = true;
    return NextResponse.json({ status: "already_ready", sourceId, ready, total });
  }
  if (total === 0) {
    // Catalog was wiped — release the in-memory flag so a refresh re-kicks.
    globalThis.__loomBootKicked = false;
  }
  if (globalThis.__loomBootKicked) {
    return NextResponse.json({ status: "already_started", sourceId, ready, total });
  }
  globalThis.__loomBootKicked = true;
  await audit("system", "boot:ensure_source", SOURCE_NAME, { sourceId });

  // Background fire-and-forget. If anything throws, log it and reset the
  // kicked flag so a refresh can retry.
  void (async () => {
    try {
      const pool = sourcePool(SOURCE_URL);
      await runLoop1(sourceId, pool, "public");
      await runLoop2All(SOURCE_URL);
      // Loop 4 — proactive view seeding. Idempotent: returns early if any
      // loom_views.* already exist for this source.
      const seed = await seedViewsForSource(sourceId);
      log.info("boot.loop4_seed", seed);
      await audit("system", "boot:done", SOURCE_NAME, { seed });
    } catch (e) {
      log.error("boot.failed", { err: String(e) });
      globalThis.__loomBootKicked = false;
      await audit("system", "boot:failed", SOURCE_NAME, { err: String(e) });
    }
  })();

  return NextResponse.json({ status: "kicked", sourceId });
}

export async function GET() {
  // Quick status check
  const r = await catalogPool.query<{ status: string; n: string }>(
    `SELECT status, count(*)::text AS n FROM tables GROUP BY status`,
  );
  return NextResponse.json({
    kicked: globalThis.__loomBootKicked === true,
    statuses: Object.fromEntries(r.rows.map((row) => [row.status, Number(row.n)])),
  });
}
