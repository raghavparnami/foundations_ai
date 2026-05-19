/**
 * Retrieval-first scaling tool: search_catalog.
 *
 * Replaces the unbounded table dump in the system prompt. The agent calls
 * this FIRST for any question that mentions an entity, metric, or table
 * name; the response gives the agent only the top-K tables + wiki pages
 * worth thinking about, by hybrid vector + lexical score.
 *
 * Two return modes:
 *   - default: merged tables + wiki ranked together
 *   - kind: "tables" — tables only, useful when the agent already knows it
 *     needs a SQL target and doesn't want wiki noise
 */
import { tool } from "ai";
import { z } from "zod";
import { searchCatalog, searchTables } from "../catalog/search";
import { audit } from "../catalog/queries";

export function searchTools(opts: { conversationId: string }) {
  return {
    search_catalog: tool({
      description:
        "Find the relevant tables and wiki pages for the user's question. ALWAYS call this BEFORE writing SQL or claiming a table doesn't exist — the agent's system prompt no longer dumps the full table list, so this is your primary discovery tool. Returns the top-K hits ranked by a hybrid of semantic similarity (vector) and exact name/word match (BM25). Pass `kind:\"tables\"` if you specifically want SQL targets and don't want wiki noise.",
      inputSchema: z.object({
        query: z
          .string()
          .min(2)
          .describe(
            "The natural-language question or entity name. Examples: 'deviation rate by line', 'orders', 'production runs failing QC'.",
          ),
        k: z
          .number()
          .int()
          .min(1)
          .max(25)
          .default(10)
          .describe("How many hits to return. Default 10; bump up if the user's question is broad."),
        kind: z
          .enum(["all", "tables"])
          .default("all")
          .describe("'all' = tables + wiki pages merged; 'tables' = SQL targets only."),
      }),
      execute: async ({ query, k, kind }) => {
        await audit("agent", "tool:search_catalog", null, {
          conversationId: opts.conversationId,
          query,
          k,
          kind,
        });
        const hits = kind === "tables" ? await searchTables(query, k) : await searchCatalog(query, k);
        if (hits.length === 0) {
          return {
            ok: true,
            hits: [],
            hint:
              "No tables or wiki pages matched. Try a broader query (single noun) or call `list_tables` once as a last resort.",
          };
        }
        return {
          ok: true,
          hits: hits.map((h) => ({
            kind: h.kind,
            qualified: h.qualified,
            title: h.title,
            summary: h.summary,
            score: round3(h.score),
            vector_sim: round3(h.vector_sim),
            lex_rank: round3(h.lex_rank),
          })),
        };
      },
    }),
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
