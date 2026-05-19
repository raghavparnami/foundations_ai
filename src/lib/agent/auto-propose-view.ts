/**
 * Server-side safety net for view creation.
 *
 * We instruct the agent to call `propose_view` after every meaningful
 * aggregate / joined / filtered / ranked query, but model compliance is
 * imperfect. After the stream ends, this scans the assistant's tool calls
 * and auto-creates a view for any view-worthy `run_sql` that wasn't already
 * paired with a `propose_view`.
 *
 * Heuristic for "view-worthy":
 *   - SQL contains aggregation (COUNT/SUM/AVG/MAX/MIN/GROUP BY/window fns)
 *   - AND (has a WHERE clause OR joins 2+ tables OR has GROUP BY)
 *   - AND is NOT a bare scalar lookup like `SELECT COUNT(*) FROM t` w/o filters
 *
 * Name generation: extract the first FROM table + hash of normalized SQL for
 * a stable, deterministic name (so the same query produces the same view name).
 */
import { createHash } from "node:crypto";
import type { UIMessage } from "ai";
import { proposeView } from "./propose-view";
import { audit } from "../catalog/queries";
import { log } from "../shared/log";

type ToolPartLike = {
  type: string;
  toolCallId?: string;
  state?: string;
  input?: { sql?: string; name?: string; [k: string]: unknown };
  output?: { ok?: boolean; [k: string]: unknown };
};

export async function autoProposeMissedViews(
  responseMessage: UIMessage,
  conversationId: string,
  userQuestion: string,
): Promise<void> {
  const parts = (responseMessage.parts ?? []) as ToolPartLike[];
  const runSqlParts = parts.filter(
    (p) => p.type === "tool-run_sql" && (p.state === "output-available" || p.state === "result"),
  );
  const proposedNames = new Set(
    parts
      .filter((p) => p.type === "tool-propose_view")
      .map((p) => (p.input?.name ?? "") as string)
      .map((n) => sanitize(n)),
  );

  for (const p of runSqlParts) {
    const sql = typeof p.input?.sql === "string" ? p.input.sql : null;
    if (!sql) continue;
    if (!isViewWorthy(sql)) continue;
    const out = p.output as { error?: string } | undefined;
    if (out?.error) continue;          // SQL guard rejected it — no view

    const baseName = generateName(sql);
    // If the agent already proposed a similar-named view in this turn, skip.
    if ([...proposedNames].some((n) => n.includes(baseName) || baseName.includes(n))) continue;

    try {
      const r = await proposeView({
        name: baseName,
        sql,
        description: shortDescription(userQuestion),
      });
      if (r.ok) {
        await audit("system", "auto_propose_view", r.qualified_name, {
          conversationId,
          reason: "agent_missed",
          sql_bytes: sql.length,
        });
        log.info("auto_propose_view.created", { name: r.qualified_name });
      } else {
        // Quietly log the rejection (cap hit, etc.) — don't surface to user.
        log.info("auto_propose_view.rejected", { error: r.error });
      }
    } catch (e) {
      log.warn("auto_propose_view.failed", { err: String(e) });
    }
  }
}

function isViewWorthy(sql: string): boolean {
  const u = sql.toUpperCase();
  const hasAgg =
    /\b(COUNT|SUM|AVG|MAX|MIN)\s*\(/.test(u) ||
    /\bGROUP\s+BY\b/.test(u) ||
    /\bRANK\s*\(/.test(u) ||
    /\bROW_NUMBER\s*\(/.test(u);
  const hasFilter = /\bWHERE\b/.test(u);
  const hasJoin = /\bJOIN\b/.test(u);
  const hasGroupBy = /\bGROUP\s+BY\b/.test(u);

  // Bare scalar: SELECT COUNT(*) FROM t  (no filters, no groups, no joins) → skip
  const bareScalar =
    /^\s*SELECT\s+COUNT\s*\(\s*\*\s*\)\s*(AS\s+\w+\s*)?\s*FROM\s+[\w.\"]+\s*;?\s*$/i.test(sql);
  if (bareScalar) return false;

  // CTE/WITH queries with any aggregate or grouping qualify.
  return hasAgg && (hasFilter || hasJoin || hasGroupBy);
}

function generateName(sql: string): string {
  // First non-CTE FROM table — best-effort.
  const fromMatch = sql.match(/\bFROM\s+(?:"?([\w]+)"?\.)?"?([\w]+)"?/i);
  const table = (fromMatch?.[2] ?? "result").toLowerCase();
  const norm = sql.replace(/\s+/g, " ").trim().toLowerCase();
  const hash = createHash("md5").update(norm).digest("hex").slice(0, 6);
  // Strip schema/prefix variants from table name.
  const safeTable = table.replace(/[^a-z0-9_]/g, "");
  return `${safeTable}_${hash}`;
}

function sanitize(n: string): string {
  return n.toLowerCase().replace(/[^a-z0-9_]/g, "");
}

function shortDescription(userQuestion: string): string {
  return `Auto-saved by Loom because the underlying query had aggregation/filters and was likely to be re-asked. Originated from: "${userQuestion.slice(0, 200)}"`;
}
