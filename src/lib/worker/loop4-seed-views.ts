/**
 * Loop 4 — proactive view seeder.
 *
 * After Loop 2 has enriched every table in a source for the first time, this
 * asks the doc-writer model to propose up to N useful aggregate views, and
 * creates each one via the same `proposeView()` path the chat agent uses.
 * That gives the source DB a baseline of pre-built metrics the user can
 * query directly — and gives the chat agent's view-first path something to
 * latch onto from minute one.
 *
 * Idempotent: if the source already has any views in `loom_views`, this
 * skips entirely. The scheduler retriggers Loop 4 when Loop 1 reports NEW
 * tables (not just changed ones) so adding a table later still seeds views
 * for it.
 *
 * Safety:
 *   - All generated SQL goes through the same SQL guard (SELECT-only).
 *   - The 100-view cap in proposeView still applies.
 *   - We cap to MAX_SEED views per call so a hallucinated dump can't fill
 *     the source.
 */
import { generateObject } from "ai";
import { z } from "zod";
import { catalogPool } from "../catalog/db";
import { docWriterModel } from "./openrouter";
import { audit } from "../catalog/queries";
import { proposeView } from "../agent/propose-view";
import { log } from "../shared/log";
import { withRules } from "./rules";

const MAX_SEED = 5;
const SEED_SCHEMA = z.object({
  views: z
    .array(
      z.object({
        name: z
          .string()
          .min(3)
          .max(60)
          .describe("snake_case, descriptive. No 'v_' prefix needed; the system adds one."),
        description: z.string().min(10).max(220),
        sql: z.string().min(20).describe("A single PostgreSQL SELECT (or WITH ... SELECT) — no trailing semicolon."),
        reason: z.string().max(140).describe("One line: why this view is useful."),
      }),
    )
    .min(1)
    .max(MAX_SEED),
});

const SYSTEM = `You are Loom's view seeder. Given the documentation for a set of
related tables in a connected database, propose ${MAX_SEED} aggregate views
that any analyst querying this database would commonly want pre-built. Each
view becomes a queryable Postgres object.

Hard rules:
- Use ONLY the tables and columns listed in the docs below. Do not invent
  columns or tables.
- The SQL must be a single SELECT (or WITH ... SELECT) statement. No DDL, no
  DML, no semicolons at the end.
- Aggregate intelligently: rates, counts, totals, top-N, time series. Avoid
  raw row dumps.
- Prefer date-filtered "last 30 days" or weekly time-series views. Use
  PostgreSQL date arithmetic (e.g. \`NOW() - INTERVAL '30 days'\`,
  \`DATE_TRUNC('week', column)\`).
- Cross-table joins are welcome where FKs make them natural.
- View names: snake_case, descriptive, end with a time-range suffix when
  relevant (e.g. \`deviation_rate_by_line_30d\`,
  \`top_equipment_by_severity_90d\`,
  \`weekly_production_trend\`).

Return exactly ${MAX_SEED} views.`;

const COOLDOWN_HOURS = 6;          // don't re-seed the same source more often than this
const SOFT_CAP_PER_SOURCE = 25;    // stop proactive seeding once a source has this many views
                                   // (the agent + safety-net can keep adding above this; we just stop proactive seeds)

export async function seedViewsForSource(sourceId: number): Promise<{
  proposed: number;
  created: number;
  skipped: boolean;
  reason?: string;
}> {
  // 1. Per-source cap: if the source already has plenty of views, don't pile
  //    on more proactively. The chat agent + auto-propose safety net still
  //    add views; this just stops the seeder from creating more.
  const have = await catalogPool.query<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM tables
      WHERE source_id = $1 AND schema_name = 'loom_views'`,
    [sourceId],
  );
  const existingCount = Number(have.rows[0]?.n ?? 0);
  if (existingCount >= SOFT_CAP_PER_SOURCE) {
    return { proposed: 0, created: 0, skipped: true, reason: `soft_cap (${existingCount}>=${SOFT_CAP_PER_SOURCE})` };
  }

  // 2. Cooldown: don't re-run for the same source within COOLDOWN_HOURS.
  //    We key off the most recent worker:loop4 audit entry for this source.
  const last = await catalogPool.query<{ ts: string }>(
    `SELECT ts::text FROM audit_log
      WHERE actor = 'worker:loop4'
        AND action IN ('seed_complete','seed_failed')
        AND (details->>'sourceId')::int = $1
      ORDER BY ts DESC LIMIT 1`,
    [sourceId],
  );
  if (last.rows[0]) {
    const ageMs = Date.now() - new Date(last.rows[0].ts).getTime();
    if (ageMs < COOLDOWN_HOURS * 3_600_000) {
      const remaining = COOLDOWN_HOURS - ageMs / 3_600_000;
      return { proposed: 0, created: 0, skipped: true, reason: `cooldown (${remaining.toFixed(1)}h remaining)` };
    }
  }

  // 2. Gather table docs for this source (base tables only, ready status).
  const tables = await catalogPool.query<{
    schema_name: string;
    table_name: string;
    markdown: string | null;
  }>(
    `SELECT t.schema_name, t.table_name, d.markdown
       FROM tables t
       LEFT JOIN docs d ON d.table_id = t.id
      WHERE t.source_id = $1
        AND t.schema_name <> 'loom_views'
        AND t.status = 'ready'
      ORDER BY t.table_name`,
    [sourceId],
  );

  if (tables.rows.length === 0) {
    return { proposed: 0, created: 0, skipped: true, reason: "no_ready_tables" };
  }

  log.info("loop4.start", { sourceId, tables: tables.rows.length });

  // 3. Compose the prompt — full doc per table, truncated to keep things sane.
  const docBlocks = tables.rows.map((r) => {
    const md = (r.markdown ?? "").slice(0, 4000);
    return [`# \`${r.schema_name}.${r.table_name}\``, "", md].join("\n");
  });
  const userMsg = [
    "## Connected tables (with generated docs)",
    "",
    docBlocks.join("\n\n---\n\n"),
    "",
    `## Task`,
    `Propose ${MAX_SEED} aggregate views the analysts on this database would benefit from. Return JSON matching the schema.`,
  ].join("\n");

  // 4. Ask the doc-writer for structured output.
  let parsed: z.infer<typeof SEED_SCHEMA>;
  try {
    const r = await generateObject({
      model: docWriterModel(),
      system: withRules(SYSTEM, "views"),
      prompt: userMsg,
      schema: SEED_SCHEMA,
      maxRetries: 2,
    });
    parsed = r.object;
  } catch (e) {
    log.error("loop4.generate_failed", { sourceId, err: String(e) });
    await audit("worker:loop4", "seed_failed", null, { sourceId, err: String(e).slice(0, 200) });
    return { proposed: 0, created: 0, skipped: true, reason: "llm_failed" };
  }

  // 5. Apply each via the same proposeView path the agent uses. Skip any
  //    name that already exists so we don't churn — proposeView would
  //    CREATE OR REPLACE, which is semantically a no-op-ish but wastes
  //    cycles and floods audit_log.
  const existingNames = await catalogPool.query<{ name: string }>(
    `SELECT name FROM proposals WHERE kind = 'view'`,
  );
  const existing = new Set(existingNames.rows.map((r) => r.name.replace(/^v_/, "")));

  let created = 0;
  let skipped_dupe = 0;
  for (const v of parsed.views) {
    const bare = v.name.replace(/^v_/, "");
    if (existing.has(bare)) {
      skipped_dupe++;
      continue;
    }
    try {
      const r = await proposeView({
        name: v.name,
        sql: v.sql,
        description: `${v.description} (auto-seeded by Loom. Reason: ${v.reason})`,
      });
      if (r.ok) {
        created++;
        await audit("worker:loop4", "seed_view", r.qualified_name, {
          sourceId,
          reason: v.reason,
        });
      } else {
        await audit("worker:loop4", "seed_view_rejected", v.name, {
          sourceId,
          error: r.error.slice(0, 200),
        });
        log.warn("loop4.view_rejected", { name: v.name, error: r.error });
      }
    } catch (e) {
      log.warn("loop4.view_failed", { name: v.name, err: String(e) });
    }
  }

  log.info("loop4.done", { sourceId, proposed: parsed.views.length, created, skipped_dupe });
  await audit("worker:loop4", "seed_complete", null, {
    sourceId,
    proposed: parsed.views.length,
    created,
    skipped_dupe,
    existing_at_start: existingCount,
  });

  return { proposed: parsed.views.length, created, skipped: false };
}
