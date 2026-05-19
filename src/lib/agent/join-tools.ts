/**
 * Agent tools for the joins graph.
 *
 *   resolve_join(from_table, to_table?)
 *     - If `to_table` given: returns the highest-confidence join between
 *       them, ready to paste into a SQL ON clause.
 *     - If `to_table` omitted: returns every known join from `from_table`,
 *       ranked. Useful when the agent knows the anchor but is exploring
 *       what's reachable.
 *
 * Together with the wiki's "Common joins" section (which the doc-writer
 * already renders from this same graph), the agent rarely needs to guess
 * a join key.
 */
import { tool } from "ai";
import { z } from "zod";
import { catalogPool } from "../catalog/db";
import { listJoinsForTable, resolveJoinPair } from "../catalog/joins";
import { audit } from "../catalog/queries";

export function joinTools(opts: { conversationId: string }) {
  return {
    resolve_join: tool({
      description:
        "Look up the agreed join clause between two tables. Pass `from_table` and `to_table` as qualified `schema.name` (e.g. 'public.deviations'). Returns the join columns + confidence + provenance ('fk', 'observed', 'name_match'). If `to_table` is omitted, returns ALL known joins from `from_table` ranked by confidence — useful when you're exploring what's reachable from one anchor.",
      inputSchema: z.object({
        from_table: z.string().describe("Qualified table name, e.g. 'public.deviations'."),
        to_table: z.string().optional().describe("Optional. If set, returns the single best join between the pair."),
      }),
      execute: async ({ from_table, to_table }) => {
        await audit("agent", "tool:resolve_join", from_table, {
          conversationId: opts.conversationId,
          to: to_table ?? null,
        });

        if (to_table) {
          const j = await resolveJoinPair(from_table, to_table);
          if (!j) {
            return {
              ok: false,
              error: `No known join between ${from_table} and ${to_table}. They may share a column name — try search_wiki, or write the SQL based on the columns each table exposes.`,
            };
          }
          return {
            ok: true,
            from: j.from_qualified,
            to: j.to_qualified,
            from_columns: j.from_columns,
            to_columns: j.to_columns,
            source: j.source,
            confidence: j.confidence,
            observed_count: j.observed_count,
            on_clause: renderOnClause(j.from_qualified!, j.from_columns, j.to_qualified!, j.to_columns),
          };
        }

        // No to_table — list all from from_table.
        const tableRow = await catalogPool.query<{ id: number }>(
          `SELECT t.id
             FROM tables t
            WHERE t.schema_name || '.' || t.table_name = $1
            LIMIT 1`,
          [from_table],
        );
        const tableId = tableRow.rows[0]?.id;
        if (!tableId) {
          return { ok: false, error: `No table named ${from_table} in the catalog.` };
        }
        const joins = await listJoinsForTable(tableId);
        return {
          ok: true,
          from: from_table,
          joins: joins.map((j) => ({
            to: j.to_qualified,
            from_columns: j.from_columns,
            to_columns: j.to_columns,
            source: j.source,
            confidence: j.confidence,
            on_clause: renderOnClause(from_table, j.from_columns, j.to_qualified!, j.to_columns),
          })),
        };
      },
    }),
  };
}

function renderOnClause(from: string, fromCols: string[], to: string, toCols: string[]): string {
  if (fromCols.length === 1 && toCols.length === 1) {
    return `JOIN ${to} ON ${from}.${fromCols[0]} = ${to}.${toCols[0]}`;
  }
  const pairs = fromCols.map((c, i) => `${from}.${c} = ${to}.${toCols[i] ?? toCols[0]}`).join(" AND ");
  return `JOIN ${to} ON ${pairs}`;
}
