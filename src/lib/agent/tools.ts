/**
 * Read tools exposed to the agent. Each tool is a Vercel AI SDK v6 tool with
 * a zod input schema and an execute handler.
 *
 * Tools also write an audit entry so the prep panel reflects agent activity.
 */
import { tool } from "ai";
import { z } from "zod";
import {
  listTables as listCatalogTables,
  listColumns,
  getDoc,
  getTableByName,
  getProfilesForTable,
  audit,
} from "../catalog/queries";
import { sourcePool, catalogPool } from "../catalog/db";
import { assertSelectOnly, UnsafeSqlError } from "./sql-guard";
import { proposeView } from "./propose-view";
import { proposeSkillCandidate } from "./propose-skill";
import { wikiTools } from "./wiki-tools";
import { memoryTools } from "./memory-tools";
import { joinTools } from "./join-tools";
import { searchTools } from "./search-tools";
import { projectTableIds } from "../catalog/projects";
import { generateReport } from "./generate-report";
import { generateChart, type ChartSpec } from "./generate-chart";
import { generatePresentation, type PresentationSpec } from "./generate-presentation";

const SOURCE_URL =
  process.env.LOOM_DEMO_SOURCE_URL ?? "postgres://loom:loom@localhost:5544/loom_demo_source";

export function agentTools(opts: {
  conversationId: string;
  sourceUrl?: string;
  projectSlug?: string | null;
}) {
  const srcUrl = opts.sourceUrl ?? SOURCE_URL;
  const projectSlug = opts.projectSlug ?? null;
  const wiki = wikiTools({ conversationId: opts.conversationId });
  const memory = memoryTools({ conversationId: opts.conversationId });
  const joins = joinTools({ conversationId: opts.conversationId });
  const search = searchTools({ conversationId: opts.conversationId });
  return {
    ...search,
    ...wiki,
    ...memory,
    ...joins,
    propose_skill: tool({
      description:
        "Stage a NEW Skill candidate from what you just established in this chat. Use this only when the conversation produced a reusable piece of canonizable knowledge — a metric definition, a formula, a domain rule, a methodology that the user is likely to apply repeatedly. Examples: 'deviation rate = COUNT(deviations) / COUNT(runs)', 'a run is considered failed if units_produced < 0.9 * units_target', 'LINE-A/B are food-grade and need contamination filters'. NOT for one-off queries or trivia. NEVER auto-create the skill — this stages a candidate the user must approve via the UI card.",
      inputSchema: z.object({
        name: z.string().min(3).max(80).describe("Human-readable skill name, e.g. 'Deviation Rate'."),
        description: z.string().min(10).max(240).describe("One sentence: what this skill is for."),
        triggers: z
          .array(z.string().min(2).max(60))
          .min(1)
          .max(8)
          .describe("Keyword phrases that match future questions, e.g. ['deviation rate', 'defect rate']."),
        body_md: z
          .string()
          .min(40)
          .describe(
            "Full playbook in Markdown. Sections: '## What it is', '## Required columns', '## SQL template' (with placeholders), '## When to use', '## Common mistakes'.",
          ),
      }),
      execute: async ({ name, description, triggers, body_md }) => {
        return proposeSkillCandidate({
          name,
          description,
          triggers,
          body_md,
          conversationId: opts.conversationId,
        });
      },
    }),

    plan: tool({
      description:
        "MANDATORY FIRST TOOL CALL on every turn. Declare your plan as 2 to 6 short, imperative steps describing what you'll do before doing it. The UI renders these as a checklist on the right that ticks off as each subsequent tool call completes. Each step should map to ONE concrete action: 'Inspect the deviations table', 'Run the aggregate query', 'Save the result as a view', 'Plot the result as a chart'. Don't include this `plan` call itself as a step.",
      inputSchema: z.object({
        steps: z
          .array(z.string().min(3).max(80))
          .min(2)
          .max(6)
          .describe("Short imperative step labels."),
      }),
      execute: async ({ steps }) => {
        await audit("agent", "tool:plan", null, {
          conversationId: opts.conversationId,
          n: steps.length,
        });
        return { ok: true, steps };
      },
    }),

    list_tables: tool({
      description:
        "List tables visible in the current scope. If a project is active, this returns only tables in that project's scope. Out-of-scope tables are mentioned in the system prompt and require user approval to query.",
      inputSchema: z.object({}),
      execute: async () => {
        await audit("agent", "tool:list_tables", projectSlug, {
          conversationId: opts.conversationId,
        });
        const allTables = await listCatalogTables();
        const scopeIds = await projectTableIds(projectSlug);
        const tables = scopeIds ? allTables.filter((t) => scopeIds.includes(t.id)) : allTables;
        return {
          project: projectSlug,
          tables: tables.map((t) => ({
            source: t.source_name,
            name: t.table_name,
            schema: t.schema_name,
            row_count: Number(t.row_count ?? 0),
            column_count: t.column_count,
            status: t.status,
          })),
        };
      },
    }),

    describe_table: tool({
      description:
        "Return the full generated documentation for a table (structural profile + semantic notes). Use this before writing SQL against an unfamiliar table.",
      inputSchema: z.object({
        table_name: z.string().describe("e.g. deviations, production_runs"),
        source_name: z
          .string()
          .optional()
          .describe("Source name; omit if there's only one connected source."),
      }),
      execute: async ({ table_name, source_name }) => {
        await audit("agent", "tool:describe_table", table_name, {
          conversationId: opts.conversationId,
        });
        const t = await getTableByName(source_name ?? "factory_demo", table_name);
        if (!t) return { error: `No table named "${table_name}" found in catalog.` };
        const cols = await listColumns(t.id);
        const profiles = await getProfilesForTable(t.id);

        // Prefer the wiki page (the source of truth going forward); fall
        // back to the legacy docs table so old data still resolves.
        const wikiSlugs = [
          `${t.schema_name}.${t.table_name}`,
          `tables/${t.schema_name}.${t.table_name}`,
        ];
        const wiki = await catalogPool.query<{ body_md: string; slug: string }>(
          `SELECT body_md, slug FROM wiki_pages WHERE slug = ANY($1::text[]) LIMIT 1`,
          [wikiSlugs],
        );
        let doc_markdown: string | null = wiki.rows[0]?.body_md ?? null;
        if (!doc_markdown) {
          const legacy = await getDoc(t.id);
          doc_markdown = legacy?.markdown ?? null;
        }

        return {
          name: t.table_name,
          schema: t.schema_name,
          row_count: Number(t.row_count ?? 0),
          status: t.status,
          columns: cols.map((c) => ({
            name: c.column_name,
            data_type: c.data_type,
            nullable: c.is_nullable,
            is_primary: c.is_primary,
            fk_target: c.fk_target,
            null_rate: profiles.get(c.id)?.null_rate ?? null,
            distinct_count: profiles.get(c.id)?.distinct_count ?? null,
          })),
          doc_markdown,
        };
      },
    }),

    sample_rows: tool({
      description: "Return up to N sample rows from a table (default 5, max 25).",
      inputSchema: z.object({
        table_name: z.string(),
        limit: z.number().int().min(1).max(25).optional(),
      }),
      execute: async ({ table_name, limit }) => {
        await audit("agent", "tool:sample_rows", table_name, {
          conversationId: opts.conversationId,
          limit,
        });
        const t = await getTableByName("factory_demo", table_name);
        if (!t) return { error: `No table named "${table_name}".` };
        const n = Math.min(25, Math.max(1, limit ?? 5));
        const pool = sourcePool(srcUrl);
        const r = await pool.query(
          `SELECT * FROM "${t.schema_name}"."${t.table_name}" LIMIT $1`,
          [n],
        );
        return {
          rows: r.rows.map(coerceRow),
          row_count: r.rowCount ?? 0,
        };
      },
    }),

    generate_report: tool({
      description:
        "Save a downloadable Markdown report for the user. Call this when the user explicitly asks for a write-up / executive summary / documentation, or when your final answer is substantive enough that a structured handoff document is useful. The user gets a download chip in the chat.",
      inputSchema: z.object({
        title: z.string().min(3).max(120),
        body_md: z.string().min(20).describe("Full Markdown body — include headings, summary tables, and any cited SQL."),
        slug: z.string().optional().describe("kebab-case slug; auto-generated from title if omitted"),
      }),
      execute: async ({ title, body_md, slug }) => {
        return generateReport({ title, body_md, slug, conversationId: opts.conversationId });
      },
    }),

    generate_chart: tool({
      description:
        "Render a chart of an aggregate the user asked for. Always call this after `run_sql` returns data the user will visualize (rates per group, time series, top-N rankings). Pass a small spec: type (bar/line/pie/area), title, x_field/y_field, and the `data` rows. The chart shows up inline in the chat and is downloadable as PNG.",
      inputSchema: z.object({
        type: z.enum(["bar", "line", "pie", "area"]).describe("Chart type."),
        title: z.string().min(3).max(120),
        x_field: z.string().describe("Name of the column in `data` used for the categorical/x axis."),
        y_field: z.string().describe("Name of the column in `data` used for the y axis (numeric)."),
        series_field: z
          .string()
          .optional()
          .describe("Optional second categorical column for grouped/stacked bars."),
        data: z
          .array(z.record(z.string(), z.union([z.string(), z.number()])))
          .min(1)
          .max(200)
          .describe("Rows of plain JSON. Each row must contain x_field and y_field keys."),
      }),
      execute: async (input) => {
        const spec: ChartSpec = {
          type: input.type,
          title: input.title,
          x_field: input.x_field,
          y_field: input.y_field,
          series_field: input.series_field,
          data: input.data,
        };
        return generateChart({ spec, conversationId: opts.conversationId });
      },
    }),

    generate_presentation: tool({
      description:
        "Build a downloadable PowerPoint (.pptx) deck for the user. Use this when they ask for a presentation, slides, or 'something I can show the team'. ALWAYS confirm: (a) audience (exec vs ops vs technical), (b) focus (specific line, time range, metric), and (c) length (3 slides, 5, 10) before generating — unless they already said. Slides support: title, summary (with up to 4 stat cards), chart (native editable PPT chart), table, bullets, closing. Order them in a narrative.",
      inputSchema: z.object({
        title: z.string().min(3).max(120),
        subtitle: z.string().max(200).optional(),
        author: z.string().max(60).optional(),
        slides: z
          .array(
            z.union([
              z.object({
                type: z.literal("title"),
                title: z.string(),
                subtitle: z.string().optional(),
              }),
              z.object({
                type: z.literal("summary"),
                headline: z.string(),
                body: z.string().optional(),
                stats: z
                  .array(z.object({ label: z.string(), value: z.string(), delta: z.string().optional() }))
                  .max(4)
                  .optional(),
              }),
              z.object({
                type: z.literal("chart"),
                headline: z.string(),
                chart_type: z.enum(["bar", "line", "pie", "area"]),
                x_field: z.string(),
                y_field: z.string(),
                data: z.array(z.record(z.string(), z.union([z.string(), z.number()]))).min(1).max(40),
                caption: z.string().optional(),
              }),
              z.object({
                type: z.literal("table"),
                headline: z.string(),
                columns: z.array(z.string()).min(1).max(8),
                rows: z.array(z.array(z.union([z.string(), z.number()]))).min(1).max(20),
                caption: z.string().optional(),
              }),
              z.object({
                type: z.literal("bullets"),
                headline: z.string(),
                bullets: z.array(z.string()).min(1).max(8),
              }),
              z.object({
                type: z.literal("closing"),
                headline: z.string(),
                body: z.string().optional(),
              }),
            ]),
          )
          .min(1)
          .max(20),
      }),
      execute: async (input) => {
        const spec = input as PresentationSpec;
        return generatePresentation({ spec, conversationId: opts.conversationId });
      },
    }),

    propose_view: tool({
      description:
        "Persist a useful SELECT as a Postgres view in the `loom_views` schema. Use this AFTER you have a working query that the user is likely to want to reuse (rates, top-N rankings, time series, executive summaries). The view is registered in the catalog and shows up in the panel immediately. Choose a short snake_case name describing the result, e.g. `deviation_rate_by_line_30d`. The system auto-prefixes `v_`.",
      inputSchema: z.object({
        name: z
          .string()
          .min(2)
          .max(60)
          .describe("snake_case, lowercase, no spaces. e.g. deviation_rate_by_line_30d"),
        sql: z
          .string()
          .describe("The SELECT statement to materialize as a view. Single statement, no trailing semicolon."),
        description: z
          .string()
          .max(400)
          .optional()
          .describe("One or two sentences explaining what the view represents."),
      }),
      execute: async ({ name, sql, description }) => {
        const r = await proposeView({ name, sql, description });
        return r;
      },
    }),

    run_sql: tool({
      description:
        "Run a read-only SELECT (or WITH ... SELECT) against the source database. Reject anything else. Always prefer this over guessing. Wrap heavy aggregates in CTEs if helpful.",
      inputSchema: z.object({
        sql: z.string().describe("A single SELECT statement, no trailing semicolon needed."),
      }),
      execute: async ({ sql }) => {
        try {
          const cleaned = assertSelectOnly(sql);
          await audit("agent", "tool:run_sql", null, {
            conversationId: opts.conversationId,
            sql: cleaned.slice(0, 500),
          });
          const pool = sourcePool(srcUrl);
          const r = await pool.query(cleaned);
          return {
            columns: r.fields.map((f) => f.name),
            rows: r.rows.slice(0, 200).map(coerceRow),
            row_count: r.rowCount ?? r.rows.length,
            truncated: r.rows.length > 200,
          };
        } catch (e) {
          if (e instanceof UnsafeSqlError) {
            return { error: `Rejected by SQL guard: ${e.message}` };
          }
          return { error: `SQL error: ${String((e as Error).message ?? e)}` };
        }
      },
    }),
  };
}

function coerceRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Date) out[k] = v.toISOString();
    else if (typeof v === "bigint") out[k] = v.toString();
    else out[k] = v;
  }
  return out;
}
