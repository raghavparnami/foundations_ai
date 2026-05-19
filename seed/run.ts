import { readFileSync } from "node:fs";
import { Client } from "pg";

const url = process.env.LOOM_DEMO_SOURCE_URL ?? "postgres://loom:loom@localhost:5544/loom_demo_source";

async function main() {
  const sql = readFileSync(new URL("./manufacturing.sql", import.meta.url), "utf8");
  const client = new Client({ connectionString: url });
  await client.connect();
  console.log("Seeding loom_demo_source…");
  await client.query(sql);
  const r = await client.query<{ table_name: string; count: string }>(
    "SELECT 'runs' AS table_name, count(*) FROM production_runs " +
      "UNION ALL SELECT 'deviations', count(*) FROM deviations " +
      "UNION ALL SELECT 'quality_checks', count(*) FROM quality_checks " +
      "UNION ALL SELECT 'equipment', count(*) FROM equipment " +
      "UNION ALL SELECT 'operators', count(*) FROM operators"
  );
  for (const row of r.rows) console.log(`  ${row.table_name}: ${row.count}`);
  await client.end();
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
