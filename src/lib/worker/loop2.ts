/**
 * Loop 2 — semantic enrichment.
 *
 * For each profiled table:
 *  - Load structural doc + a small sample of rows + column profiles
 *  - Ask DeepSeek (via OpenRouter) to write the semantic half of the doc:
 *    what the table represents, common filters/joins, column meanings
 *  - Splice the Claude-authored block in, preserving any human-tagged blocks
 *  - Re-persist the doc row + audit
 */
import { generateText } from "ai";
import { catalogPool } from "../catalog/db";
import { audit } from "../catalog/queries";
import { docWriterModel } from "./openrouter";
import { sourcePool } from "../catalog/db";
import { countProvenance, provenanceWrap, splitBlocks } from "./markdown";
import { log } from "../shared/log";

const SYSTEM = `You are Loom, an assistant that writes precise, terse semantic
documentation for database tables. You are given a table's structural profile,
a sample of rows, and (if available) a "Recent agent queries on this table"
section drawn from the actual audit log of queries Loom has run. Use them.

Write a Markdown section that includes exactly:

  ## What this table represents
  One or two sentences. Domain-grounded, not generic.

  ## Common joins
  Bullet list of likely join targets. **Prefer joins you can see in the
  Recent queries section** — quote the JOIN ... ON clause verbatim where you
  can. Only fall back to FK/column-name inference if there are no recent
  queries. If still nothing, write "None obvious from this profile."

  ## Column meanings
  Bullet list, one per column. Skip self-explanatory IDs/timestamps unless
  there's something non-obvious. Format: \`column_name\` — meaning.

  ## Likely filter patterns
  Bullet list of WHERE clauses an analyst would commonly use. **Prefer
  filters you can see in the Recent queries section.** Otherwise infer from
  column types and top values. 2–4 items.

Write nothing outside these four sections. No preamble, no apologies, no
"As an AI". Use backticks for identifiers.`;

type EnrichInput = {
  tableId: number;
  sourceUrl: string;
};

export async function runLoop2ForTable(input: EnrichInput): Promise<void> {
  const { tableId, sourceUrl } = input;
  const ctx = await loadContext(tableId, sourceUrl);
  if (!ctx) return;

  await setStatus(tableId, "enriching");
  log.info("loop2.start", { table: `${ctx.schema_name}.${ctx.table_name}` });

  const userMsg = renderPrompt(ctx);
  const result = await generateText({
    model: docWriterModel(),
    system: SYSTEM,
    prompt: userMsg,
    maxRetries: 1,
  });

  const semanticMd = provenanceWrap(
    "claude",
    result.text.trim(),
    `${new Date().toISOString().slice(0, 10)}, model=${process.env.LOOM_DOC_WRITER_MODEL ?? "deepseek/deepseek-chat-v3.1"}`,
  );

  const merged = mergeIntoDoc(ctx.markdown, semanticMd);
  const provenance = countProvenance(merged);
  await catalogPool.query(
    `UPDATE docs SET markdown = $1, provenance = $2::jsonb, updated_at = now()
       WHERE table_id = $3`,
    [merged, JSON.stringify(provenance), tableId],
  );

  // On-disk mirror removed: foundation_ai.docs.markdown is the source of
  // truth, and the tables-wiki agent picks it up into foundation_ai.wiki_pages.
  await catalogPool.query(
    `UPDATE tables SET status = 'ready', last_enriched_at = now() WHERE id = $1`,
    [tableId],
  );
  await audit("worker:loop2", "enrich_table", `${ctx.schema_name}.${ctx.table_name}`, {
    bytes: semanticMd.length,
  });
  log.info("loop2.done", { table: `${ctx.schema_name}.${ctx.table_name}`, bytes: semanticMd.length });
}

export async function runLoop2All(sourceUrl: string): Promise<void> {
  const r = await catalogPool.query<{ id: number }>(
    `SELECT id FROM tables WHERE status IN ('profiled','enriching') ORDER BY id`,
  );
  for (const row of r.rows) {
    try {
      await runLoop2ForTable({ tableId: row.id, sourceUrl });
    } catch (e) {
      log.error("loop2.table_failed", { tableId: row.id, err: String(e) });
      await catalogPool.query(`UPDATE tables SET status = 'profiled' WHERE id = $1`, [row.id]);
    }
  }
}

/**
 * Re-enrich a specific set of tables — used by the scheduler when Loop 1
 * reports a schema_hash change, or when the user explicitly forces a refresh.
 */
export async function runLoop2ForTables(sourceUrl: string, tableIds: number[]): Promise<void> {
  for (const id of tableIds) {
    try {
      await runLoop2ForTable({ tableId: id, sourceUrl });
      await catalogPool.query(`UPDATE tables SET dirty = FALSE WHERE id = $1`, [id]);
    } catch (e) {
      log.error("loop2.table_failed", { tableId: id, err: String(e) });
      await catalogPool.query(`UPDATE tables SET status = 'profiled' WHERE id = $1`, [id]);
    }
  }
}

type Ctx = {
  schema_name: string;
  table_name: string;
  markdown: string;
  sampleRows: Record<string, unknown>[];
  recentQueries: string[];
};

async function loadContext(tableId: number, sourceUrl: string): Promise<Ctx | null> {
  const tableRow = await catalogPool.query<{ schema_name: string; table_name: string }>(
    `SELECT schema_name, table_name FROM tables WHERE id = $1`,
    [tableId],
  );
  const t = tableRow.rows[0];
  if (!t) return null;

  const docRow = await catalogPool.query<{ markdown: string }>(
    `SELECT markdown FROM docs WHERE table_id = $1`,
    [tableId],
  );
  if (!docRow.rows[0]) return null;

  const pool = sourcePool(sourceUrl);
  const samples = await pool.query(
    `SELECT * FROM "${t.schema_name}"."${t.table_name}" LIMIT 5`,
  );

  // Pull recent agent SQL that referenced this table, so the LLM can ground
  // the "Common joins" and "Likely filter patterns" sections in actual usage.
  const tablePattern = `%${t.table_name}%`;
  const queries = await catalogPool.query<{ sql: string }>(
    `SELECT (details->>'sql') AS sql
       FROM audit_log
      WHERE action = 'tool:run_sql'
        AND details->>'sql' ILIKE $1
      ORDER BY ts DESC
      LIMIT 10`,
    [tablePattern],
  );

  return {
    schema_name: t.schema_name,
    table_name: t.table_name,
    markdown: docRow.rows[0].markdown,
    sampleRows: samples.rows,
    recentQueries: queries.rows.map((r) => r.sql).filter(Boolean),
  };
}

function renderPrompt(ctx: Ctx): string {
  const queryBlock = ctx.recentQueries.length > 0
    ? [
        "",
        "## Recent agent queries on this table",
        "Use these to ground the 'Common joins' and 'Likely filter patterns'",
        "sections in real usage. Quote join keys and WHERE clauses you actually",
        "observe; ignore one-offs.",
        "",
        ctx.recentQueries.map((q, i) => `### Query ${i + 1}\n\`\`\`sql\n${q}\n\`\`\``).join("\n\n"),
      ].join("\n")
    : "";
  return [
    `# Structural profile of \`${ctx.schema_name}.${ctx.table_name}\``,
    "",
    ctx.markdown,
    "",
    "## Sample rows (up to 5)",
    "",
    "```json",
    JSON.stringify(ctx.sampleRows, jsonReplacer, 2),
    "```",
    queryBlock,
  ].join("\n");
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  return value;
}

/**
 * Insert the new claude-authored block after the schema-authored summary block,
 * preserving anything tagged `human`.
 */
function mergeIntoDoc(existing: string, semanticBlock: string): string {
  const blocks = splitBlocks(existing);
  const kept = blocks.filter((b) => b.provenance !== "claude");

  // Find the first schema block (table title + summary). Insert semantic
  // block right after it.
  let inserted = false;
  const out: string[] = [];
  for (const b of kept) {
    out.push(b.raw);
    if (!inserted && b.provenance === "schema" && /^#\s/m.test(b.raw) === false) {
      out.push(semanticBlock);
      inserted = true;
    }
  }
  if (!inserted) out.push(semanticBlock);
  return out.join("\n");
}

async function setStatus(tableId: number, status: string) {
  await catalogPool.query(`UPDATE tables SET status = $1 WHERE id = $2`, [status, tableId]);
}
