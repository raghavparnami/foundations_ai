import { tool } from "ai";
import { z } from "zod";
import { catalogPool } from "../../catalog/db";

export const listTablesTool = tool({
  description:
    "List every table Loom knows about, with its row count, status (pending/profiling/profiled/enriching/ready), and a one-line summary derived from its catalog doc. Use this first when the user asks an open question — it's the index into the schema.",
  inputSchema: z.object({}),
  execute: async () => {
    const r = await catalogPool.query<{
      id: number;
      schema_name: string;
      table_name: string;
      row_count: number | null;
      status: string;
      summary: string;
    }>(
      `SELECT
         t.id, t.schema_name, t.table_name, t.row_count, t.status,
         COALESCE(
           regexp_replace(
             substring(d.markdown FROM 'The \\\`[^\\\`]+\\\` table[^\\n]*'),
             E'\\n', ' ', 'g'
           ),
           '(not yet documented)'
         ) AS summary
       FROM tables t
       LEFT JOIN docs d ON d.table_id = t.id
       ORDER BY t.table_name`
    );
    return {
      count: r.rows.length,
      tables: r.rows.map((row) => ({
        name: `${row.schema_name}.${row.table_name}`,
        id: row.id,
        row_count: row.row_count,
        status: row.status,
        summary: row.summary,
      })),
    };
  },
});
