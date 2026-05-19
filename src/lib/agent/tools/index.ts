import { listTablesTool } from "./list_tables";
import { describeTableTool } from "./describe_table";
import { sampleRowsTool } from "./sample_rows";
import { runSqlTool } from "./run_sql";

/**
 * Factory so tools can be parameterized by request-scoped context
 * (conversationId, user id, etc.) in later phases. v0.1 uses none of it,
 * but the surface area is here so plan mode + audit can flow through later.
 */
export function agentTools(_ctx: { conversationId: string }) {
  return {
    list_tables: listTablesTool,
    describe_table: describeTableTool,
    sample_rows: sampleRowsTool,
    run_sql: runSqlTool,
  } as const;
}
