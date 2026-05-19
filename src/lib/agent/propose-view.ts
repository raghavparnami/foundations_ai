/**
 * Implementation of the `propose_view` tool. Given a SQL SELECT and a view
 * name, this:
 *   1. Validates the SQL is SELECT-only via the same guard the agent uses.
 *   2. Creates a `loom_views` schema in the source DB (idempotent).
 *   3. Runs CREATE OR REPLACE VIEW loom_views.<safe_name> AS <sql>.
 *   4. Introspects the view's columns via information_schema.
 *   5. Registers the view in the catalog so it appears in the Always-Preparing
 *      panel — table row + column rows + a small markdown doc.
 *   6. Records the proposal in `proposals` and writes an audit entry.
 *
 * "Propose" is in the name to match CLAUDE.md vocabulary; in v0.1 we skip the
 * approve-before-apply ceremony and apply on call. The proposals table still
 * stores the full SQL so future versions can add a review queue without a
 * schema change.
 */
import { catalogPool, sourcePool } from "../catalog/db";
import { audit } from "../catalog/queries";
import { assertSelectOnly, UnsafeSqlError } from "./sql-guard";
import { extractInsightsForView } from "../worker/insights";

const SOURCE_URL =
  process.env.LOOM_DEMO_SOURCE_URL ??
  "postgres://loom:loom@localhost:5544/loom_demo_source";
const SOURCE_NAME = "factory_demo";
const VIEW_SCHEMA = "loom_views";

export type ProposeViewInput = {
  name: string;
  sql: string;
  description?: string;
};

export type ProposeViewResult =
  | {
      ok: true;
      view_name: string;
      qualified_name: string;
      columns: { name: string; data_type: string }[];
      row_count: number;
    }
  | { ok: false; error: string };

export async function proposeView(input: ProposeViewInput): Promise<ProposeViewResult> {
  // 1. Sanitize the view name.
  const safeName = sanitizeViewName(input.name);
  if (!safeName) {
    return { ok: false, error: `Invalid view name "${input.name}". Use lowercase letters, digits, and underscores; start with a letter.` };
  }

  // 2. Validate the SQL.
  let cleaned: string;
  try {
    cleaned = assertSelectOnly(input.sql);
  } catch (e) {
    if (e instanceof UnsafeSqlError) return { ok: false, error: `Rejected by SQL guard: ${e.message}` };
    return { ok: false, error: `SQL parse failed: ${String(e)}` };
  }

  const pool = sourcePool(SOURCE_URL);
  const qualified = `${VIEW_SCHEMA}.${safeName}`;

  // 3a. Per-source cap: 100 views max. UPDATE (CREATE OR REPLACE) of an
  // existing view is always allowed; only fresh creations count against the
  // cap. This protects the source DB from unbounded view sprawl.
  try {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS "${VIEW_SCHEMA}"`);
    const exists = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM information_schema.views
        WHERE table_schema = $1 AND table_name = $2`,
      [VIEW_SCHEMA, safeName],
    );
    const isUpdate = Number(exists.rows[0]?.n ?? 0) > 0;
    if (!isUpdate) {
      const total = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM information_schema.views WHERE table_schema = $1`,
        [VIEW_SCHEMA],
      );
      const count = Number(total.rows[0]?.n ?? 0);
      if (count >= 100) {
        return {
          ok: false,
          error: `View limit reached: this database already has ${count} views in \`${VIEW_SCHEMA}\` (max 100). Delete an unused view in /admin and try again.`,
        };
      }
    }
  } catch (e) {
    return { ok: false, error: `Postgres rejected the view check: ${(e as Error).message}` };
  }

  // 3b. Create or replace the view.
  try {
    await pool.query(`CREATE OR REPLACE VIEW "${VIEW_SCHEMA}"."${safeName}" AS ${cleaned}`);
  } catch (e) {
    return { ok: false, error: `Postgres rejected the view: ${(e as Error).message}` };
  }

  // 4. Introspect resulting columns.
  const colsRes = await pool.query<{ column_name: string; ordinal_position: number; data_type: string; is_nullable: string }>(
    `SELECT column_name, ordinal_position, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position`,
    [VIEW_SCHEMA, safeName],
  );
  const cols = colsRes.rows;

  // 5. Get a row count (cap the underlying query for safety).
  let rowCount = 0;
  try {
    const r = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM "${VIEW_SCHEMA}"."${safeName}"`,
    );
    rowCount = Number(r.rows[0]?.n ?? 0);
  } catch {
    rowCount = 0;
  }

  // 6. Register in the catalog so the panel shows it.
  const sourceIdRow = await catalogPool.query<{ id: number }>(
    `SELECT id FROM sources WHERE name = $1`,
    [SOURCE_NAME],
  );
  const sourceId = sourceIdRow.rows[0]?.id;
  if (!sourceId) return { ok: false, error: "Source not registered yet — wait for boot to complete." };

  const tableRow = await catalogPool.query<{ id: number }>(
    `INSERT INTO tables (source_id, schema_name, table_name, row_count, status, last_profiled_at)
       VALUES ($1, $2, $3, $4, 'ready', now())
     ON CONFLICT (source_id, schema_name, table_name) DO UPDATE
        SET row_count = EXCLUDED.row_count,
            status = 'ready',
            last_profiled_at = now()
     RETURNING id`,
    [sourceId, VIEW_SCHEMA, safeName, rowCount],
  );
  const tableId = tableRow.rows[0]!.id;

  // Clear and re-insert columns for this view.
  await catalogPool.query(`DELETE FROM columns WHERE table_id = $1`, [tableId]);
  for (const c of cols) {
    await catalogPool.query(
      `INSERT INTO columns (table_id, column_name, ordinal, data_type, is_nullable, is_primary)
         VALUES ($1, $2, $3, $4, $5, FALSE)`,
      [tableId, c.column_name, c.ordinal_position, c.data_type, c.is_nullable === "YES"],
    );
  }

  // Inline markdown — no Loop 2 call for views; the agent already knows what
  // it built.
  const md = renderViewDoc(qualified, input.description, cleaned, cols, rowCount);
  const path = `loom-catalog/${SOURCE_NAME}/${VIEW_SCHEMA}/${safeName}.md`;
  await catalogPool.query(
    `INSERT INTO docs (table_id, path, markdown, provenance, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, now())
     ON CONFLICT (table_id) DO UPDATE
        SET path = EXCLUDED.path,
            markdown = EXCLUDED.markdown,
            provenance = EXCLUDED.provenance,
            updated_at = now()`,
    [tableId, path, md, JSON.stringify({ schema: 1, claude: 1 })],
  );

  // 7. Record proposal + audit.
  await catalogPool.query(
    `INSERT INTO proposals (kind, name, description, sql, status)
       VALUES ('view', $1, $2, $3, 'applied')
     ON CONFLICT (kind, name) DO UPDATE
        SET description = EXCLUDED.description,
            sql = EXCLUDED.sql,
            status = 'applied',
            created_at = now()`,
    [safeName, input.description ?? null, cleaned],
  );
  await audit("agent", "propose_view", qualified, {
    columns: cols.length,
    row_count: rowCount,
    bytes: cleaned.length,
  });

  // Fire-and-forget: extract insights from the newly-created view so the
  // upper-right "Insight" pill has something fresh to show.
  void extractInsightsForView(safeName).catch(() => {});

  return {
    ok: true,
    view_name: safeName,
    qualified_name: qualified,
    columns: cols.map((c) => ({ name: c.column_name, data_type: c.data_type })),
    row_count: rowCount,
  };
}

function sanitizeViewName(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  // Optional v_ prefix; collapse spaces to underscores.
  const replaced = trimmed.replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
  if (!/^[a-z][a-z0-9_]{0,60}$/.test(replaced)) return null;
  return replaced.startsWith("v_") ? replaced : `v_${replaced}`;
}

function renderViewDoc(
  qualified: string,
  description: string | undefined,
  sql: string,
  cols: { column_name: string; data_type: string }[],
  rowCount: number,
): string {
  const colTable = [
    `| Column | Type |`,
    `| --- | --- |`,
    ...cols.map((c) => `| \`${c.column_name}\` | ${c.data_type} |`),
  ].join("\n");
  return [
    `# ${qualified}`,
    ``,
    `<!-- provenance: schema -->`,
    `This is a **view** created by Loom. ${rowCount} row${rowCount === 1 ? "" : "s"} as of ${new Date().toISOString().slice(0, 10)}.`,
    ``,
    `<!-- provenance: claude, ${new Date().toISOString().slice(0, 10)} -->`,
    `## What this view represents`,
    description?.trim() || "_No description provided._",
    ``,
    `## Definition`,
    ``,
    "```sql",
    sql,
    "```",
    ``,
    `<!-- provenance: schema -->`,
    `## Columns`,
    ``,
    colTable,
    ``,
  ].join("\n");
}
