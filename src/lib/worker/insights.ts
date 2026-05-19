/**
 * Insights extractor.
 *
 * For each saved view that doesn't yet have insights, query a sample of rows
 * and ask the doc-writer model to surface 1–3 short findings (importance 1–5).
 * Saved into `insights` table; rendered in the upper-right panel of the chat.
 */
import { generateObject } from "ai";
import { z } from "zod";
import { catalogPool, sourcePool } from "../catalog/db";
import { docWriterModel } from "./openrouter";
import { audit } from "../catalog/queries";
import { log } from "../shared/log";

const SOURCE_URL =
  process.env.LOOM_DEMO_SOURCE_URL ??
  "postgres://loom:loom@localhost:5544/loom_demo_source";

const InsightSchema = z.object({
  findings: z
    .array(
      z.object({
        headline: z.string().min(10).max(120).describe("One short sentence stating the finding."),
        body: z.string().max(280).optional().describe("One additional sentence with numbers or context."),
        importance: z.number().int().min(1).max(5).describe("1=trivia, 3=worth knowing, 5=critical."),
      }),
    )
    .min(1)
    .max(3),
});

export async function extractInsightsForView(viewSlug: string): Promise<{
  ok: boolean;
  inserted: number;
  error?: string;
}> {
  // Skip if we already have insights for this view (idempotent).
  const existing = await catalogPool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM insights WHERE view_slug = $1`,
    [viewSlug],
  );
  if (Number(existing.rows[0]?.n ?? 0) > 0) {
    return { ok: true, inserted: 0 };
  }

  // Sample the view (up to 25 rows) and snapshot the column list.
  const src = sourcePool(SOURCE_URL);
  let sample: Record<string, unknown>[];
  let columns: string[];
  try {
    const r = await src.query(`SELECT * FROM loom_views."${viewSlug}" LIMIT 25`);
    sample = r.rows;
    columns = r.fields.map((f) => f.name);
  } catch (e) {
    return { ok: false, inserted: 0, error: `Failed to read view: ${(e as Error).message}` };
  }
  if (sample.length === 0) {
    return { ok: true, inserted: 0 };
  }

  // Ask the doc-writer for 1–3 short findings, structured.
  let result;
  try {
    result = await generateObject({
      model: docWriterModel(),
      schema: InsightSchema,
      maxRetries: 1,
      prompt: [
        `You are extracting analyst-grade findings from a Postgres view called \`loom_views.${viewSlug}\`.`,
        "",
        `Columns: ${columns.join(", ")}`,
        "",
        "Sample rows (JSON):",
        "```json",
        JSON.stringify(sample, jsonReplacer, 2).slice(0, 8000),
        "```",
        "",
        "Surface 1-3 SHORT, factual findings an exec would care about.",
        "Rules:",
        "- Headline: a single sentence, present tense, with the specific number.",
        "  Examples: 'LINE-B has the highest deviation rate at 78%.'",
        "           'Capper-B2 caused 55 deviations — 17% of the total.'",
        "- Body (optional): one sentence with the supporting numbers or context.",
        "- importance 1=trivia, 3=worth knowing, 5=urgent / outlier.",
        "- Do NOT invent. If the data doesn't support a finding, omit it.",
        "- Do NOT recommend actions. Just observations.",
      ].join("\n"),
    });
  } catch (e) {
    log.warn("insights.llm_failed", { view: viewSlug, err: String(e) });
    return { ok: false, inserted: 0, error: String(e) };
  }

  // Persist each finding, on conflict (view, headline) keep the higher
  // importance one to avoid duplicates from re-runs.
  let inserted = 0;
  for (const f of result.object.findings) {
    const r = await catalogPool.query<{ id: number }>(
      `INSERT INTO insights (view_slug, headline, body, importance)
         VALUES ($1, $2, $3, $4)
       ON CONFLICT (view_slug, headline) DO UPDATE
          SET body = COALESCE(EXCLUDED.body, insights.body),
              importance = GREATEST(insights.importance, EXCLUDED.importance)
       RETURNING id`,
      [viewSlug, f.headline.trim(), f.body?.trim() ?? null, f.importance],
    );
    if (r.rowCount && r.rowCount > 0) inserted++;
  }

  await audit("worker:insights", "extract", `loom_views.${viewSlug}`, { findings: inserted });
  log.info("insights.extracted", { view: viewSlug, n: inserted });
  return { ok: true, inserted };
}

/**
 * For each view that doesn't yet have insights, extract some. Used by the
 * scheduler tick and after Loop 4 view-seeding completes.
 */
export async function extractInsightsForMissingViews(): Promise<{ scanned: number; extracted: number }> {
  const views = await catalogPool.query<{ name: string }>(
    `SELECT name FROM proposals WHERE kind = 'view' AND status = 'applied'`,
  );
  let extracted = 0;
  for (const v of views.rows) {
    try {
      const r = await extractInsightsForView(v.name);
      if (r.ok && r.inserted > 0) extracted += r.inserted;
    } catch (e) {
      log.warn("insights.view_failed", { view: v.name, err: String(e) });
    }
  }
  return { scanned: views.rows.length, extracted };
}

function jsonReplacer(_k: string, v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return v.toString();
  return v;
}
