import { tool } from "ai";
import { z } from "zod";
import { catalogPool } from "../../catalog/db";

export const describeTableTool = tool({
  description:
    "Return the full catalog markdown for a table — structural profile (columns, null rates, top values, histogram) plus the LLM-authored semantic section (what the table represents, common joins, column meanings, filter patterns). Always call this before run_sql so your query reflects the table's actual semantics.",
  inputSchema: z.object({
    table: z
      .string()
      .describe("Fully qualified table name like 'public.deviations'. The schema prefix is required."),
  }),
  execute: async ({ table }) => {
    const [schema, name] = table.includes(".") ? table.split(".", 2) : ["public", table];
    if (!schema || !name) {
      return { error: `Invalid table name: ${table}. Use 'schema.table' form.` };
    }
    const r = await catalogPool.query<{
      markdown: string;
      provenance: Record<string, number>;
      status: string;
      row_count: number | null;
    }>(
      `SELECT d.markdown, d.provenance, t.status, t.row_count
       FROM tables t LEFT JOIN docs d ON d.table_id = t.id
       WHERE t.schema_name = $1 AND t.table_name = $2`,
      [schema, name]
    );
    const row = r.rows[0];
    if (!row) return { error: `Table not found in catalog: ${table}` };
    return {
      table,
      status: row.status,
      row_count: row.row_count,
      provenance: row.provenance,
      markdown: row.markdown ?? "(no documentation yet)",
    };
  },
});
