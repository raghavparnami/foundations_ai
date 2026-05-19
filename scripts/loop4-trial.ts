import "@next/env/dist/index.js"; // no-op safety
import { seedViewsForSource } from "../src/lib/worker/loop4-seed-views";
import { catalogPool } from "../src/lib/catalog/db";

(async () => {
  try {
    console.log("Loop 4: seeding for sourceId=1…");
    const r = await seedViewsForSource(1);
    console.log("RESULT", r);
  } catch (e) {
    console.error("ERR", (e as Error).message);
    console.error((e as Error).stack);
  } finally {
    await catalogPool.end().catch(() => {});
    process.exit(0);
  }
})();
