/**
 * CLI runner for Loop 2 against the demo source.
 */
import { runLoop2All } from "./loop2";
import { catalogPool } from "../catalog/db";
import { env } from "../shared/env";

async function main() {
  const e = env();
  const t0 = Date.now();
  await runLoop2All(e.LOOM_DEMO_SOURCE_URL);
  console.log(`[loop2] done elapsed=${Date.now() - t0}ms`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then(async () => {
      await catalogPool.end();
      process.exit(0);
    })
    .catch(async (e) => {
      console.error(e);
      await catalogPool.end().catch(() => {});
      process.exit(1);
    });
}
