/**
 * One-shot runner for Loop 1. Used by `npm run loop1` for the demo,
 * also imported by the boot route.
 */
import { ensureSource, runLoop1 } from "./loop1";
import { catalogPool, sourcePool } from "../catalog/db";
import { env } from "../shared/env";

const DEMO_NAME = "demo";

export async function bootstrapDemoSourceLoop1(): Promise<{ sourceId: number; ms: number }> {
  const e = env();
  const sourceId = await ensureSource(DEMO_NAME, "postgres", e.LOOM_DEMO_SOURCE_URL);
  const pool = sourcePool(e.LOOM_DEMO_SOURCE_URL);
  const t0 = Date.now();
  await runLoop1(sourceId, pool, "public");
  return { sourceId, ms: Date.now() - t0 };
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  bootstrapDemoSourceLoop1()
    .then(async ({ sourceId, ms }) => {
      console.log(`[loop1] done sourceId=${sourceId} elapsed=${ms}ms`);
      await catalogPool.end();
      process.exit(0);
    })
    .catch(async (e) => {
      console.error(e);
      await catalogPool.end().catch(() => {});
      process.exit(1);
    });
}
