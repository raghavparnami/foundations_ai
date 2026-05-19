import { tool } from "ai";
import { z } from "zod";
import { Parser } from "node-sql-parser";
import { catalogPool, sourcePool } from "../../catalog/db";
import { audit } from "../../catalog/queries";

const parser = new Parser();

/**
 * Validate that a SQL string is a single read-only SELECT (or WITH … SELECT).
 * We parse to an AST rather than regex-matching so things like
 * `SELECT 1 -- DELETE FROM foo` can't slip through.
 */
function assertReadOnly(sql: string): { ok: true } | { ok: false; reason: string } {
  let ast: unknown;
  try {
    ast = parser.astify(sql, { database: "PostgreSQL" });
  } catch (e) {
    return { ok: false, reason: `Parse error: ${String(e)}` };
  }
  const statements = Array.isArray(ast) ? ast : [ast];
  if (statements.length !== 1) {
    return { ok: false, reason: "Multiple statements are not allowed. Send one SELECT at a time." };
  }
  const s = statements[0] as { type?: string };
  if (s.type !== "select") {
    return { ok: false, reason: `Only SELECT is allowed in v0.1. Got: ${s.type ?? "unknown"}` };
  }
  return { ok: true };
}

const MAX_ROWS = 200;

export const runSqlTool = tool({
  description:
    "Execute a single read-only SELECT against the connected source database. The SQL is parsed and validated — non-SELECT statements are rejected. Results are capped at 200 rows. Always describe_table first so you know real column names and types.",
  inputSchema: z.object({
    sql: z.string().min(8).describe("A single SELECT statement. WITH/CTE allowed."),
    source: z
      .string()
      .default("demo")
      .describe("Source name. Defaults to 'demo' — the only source in v0.1."),
  }),
  execute: async ({ sql, source }) => {
    const v = assertReadOnly(sql);
    if (!v.ok) {
      return { error: v.reason, sql };
    }

    const srcRow = await catalogPool.query<{ conn_url: string }>(
      `SELECT conn_url FROM sources WHERE name = $1`,
      [source]
    );
    const url = srcRow.rows[0]?.conn_url;
    if (!url) return { error: `Source not found: ${source}` };

    // Enforce a soft row cap by wrapping in a subquery.
    const wrapped = `SELECT * FROM ( ${sql.trim().replace(/;\s*$/, "")} ) AS loom_q LIMIT ${MAX_ROWS}`;

    const pool = sourcePool(url);
    const t0 = Date.now();
    try {
      const r = await pool.query(wrapped);
      const ms = Date.now() - t0;
      await audit("agent", "run_sql", source, { sql, rows: r.rowCount, ms });
      return {
        rows: r.rows,
        rowCount: r.rowCount,
        truncated: (r.rowCount ?? 0) >= MAX_ROWS,
        elapsed_ms: ms,
      };
    } catch (e) {
      await audit("agent", "run_sql_failed", source, { sql, err: String(e) });
      return { error: `SQL error: ${String(e)}`, sql };
    }
  },
});
