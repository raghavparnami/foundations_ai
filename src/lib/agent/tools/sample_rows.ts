import { tool } from "ai";
import { z } from "zod";
import { catalogPool, sourcePool } from "../../catalog/db";

export const sampleRowsTool = tool({
  description:
    "Return up to N sample rows from a table. Useful when you need to see the actual data shape, format, or value patterns that the catalog doc doesn't capture. Max 25 rows.",
  inputSchema: z.object({
    table: z.string().describe("Fully qualified 'schema.table' name, e.g. 'public.deviations'."),
    limit: z.number().int().min(1).max(25).default(5),
  }),
  execute: async ({ table, limit }) => {
    const [schema, name] = table.includes(".") ? table.split(".", 2) : ["public", table];
    if (!schema || !name) return { error: `Invalid table name: ${table}` };

    const meta = await catalogPool.query<{ source_url: string }>(
      `SELECT s.conn_url AS source_url
       FROM tables t JOIN sources s ON s.id = t.source_id
       WHERE t.schema_name = $1 AND t.table_name = $2`,
      [schema, name]
    );
    const sourceUrl = meta.rows[0]?.source_url;
    if (!sourceUrl) return { error: `Table not found: ${table}` };

    const pool = sourcePool(sourceUrl);
    try {
      const r = await pool.query(`SELECT * FROM "${schema}"."${name}" LIMIT $1`, [limit]);
      return { table, rows: r.rows, count: r.rows.length };
    } catch (e) {
      return { error: `Failed to sample ${table}: ${String(e)}` };
    }
  },
});
