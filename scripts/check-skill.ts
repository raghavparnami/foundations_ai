import { matchSkills } from "../src/lib/catalog/skills";
import { catalogPool } from "../src/lib/catalog/db";

(async () => {
  for (const q of [
    "What's the quality deviation trend this month?",
    "How are defects trending?",
    "what is throughput",
    "who is naruto",
  ]) {
    const m = await matchSkills(q, 3);
    console.log(`"${q}"`);
    if (m.length === 0) console.log("  → no skill match");
    for (const s of m) console.log(`  → ${s.slug} (triggers ${JSON.stringify(s.triggers)})`);
  }
  await catalogPool.end();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
