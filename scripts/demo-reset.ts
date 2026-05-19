/**
 * Demo reset — wipes the catalog so the next page load replays the
 * "Loom is always preparing" animation from scratch. Source data is untouched.
 *
 * Run: `npm run demo:reset`
 */
import { Pool } from "pg";

const url = process.env.LOOM_CATALOG_URL ?? "postgres://loom:loom@localhost:5544/loom_catalog";

async function main() {
  const pool = new Pool({ connectionString: url });
  console.log("[demo:reset] clearing catalog tables…");
  // TRUNCATE … CASCADE clears every dependent row in one shot.
  await pool.query(`TRUNCATE sources, tables, columns, column_profiles, docs, embeddings, audit_log RESTART IDENTITY CASCADE`);
  console.log("[demo:reset] done. Reload the browser to replay the boot loop.");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
