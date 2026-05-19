/**
 * Implementation of the `generate_chart` agent tool. Saves a chart spec
 * (bar / line / pie + axis fields + data rows) and returns a slug the UI
 * uses to render via Recharts.
 *
 * Spec is intentionally lightweight — not Vega-Lite — so the model doesn't
 * need to know a complex grammar. Anything that fits "two columns of data,
 * one chart" works.
 */
import { catalogPool } from "../catalog/db";
import { audit } from "../catalog/queries";

export type ChartType = "bar" | "line" | "pie" | "area";

export type ChartSpec = {
  type: ChartType;
  title: string;
  x_field: string;
  y_field: string;
  data: Record<string, string | number>[];
  // Optional: a second y-series for grouped/stacked bars
  series_field?: string;
};

export type GenerateChartInput = {
  spec: ChartSpec;
  slug?: string;
  conversationId: string;
};

export type GenerateChartResult =
  | { ok: true; slug: string; title: string; type: ChartType; preview_url: string }
  | { ok: false; error: string };

export async function generateChart(input: GenerateChartInput): Promise<GenerateChartResult> {
  const s = input.spec;
  if (!s || typeof s !== "object") return { ok: false, error: "spec is required" };
  if (!s.type || !["bar", "line", "pie", "area"].includes(s.type)) {
    return { ok: false, error: "spec.type must be one of: bar, line, pie, area" };
  }
  if (!s.title?.trim()) return { ok: false, error: "spec.title is required" };
  if (!s.x_field || !s.y_field) return { ok: false, error: "spec.x_field and spec.y_field are required" };
  if (!Array.isArray(s.data) || s.data.length === 0) return { ok: false, error: "spec.data must be a non-empty array of rows" };

  const slug = sanitizeSlug(input.slug || s.title) || `chart-${Date.now()}`;

  const r = await catalogPool.query<{ id: number; slug: string }>(
    `INSERT INTO charts (slug, title, spec, conversation_id)
       VALUES ($1, $2, $3::jsonb, $4)
     ON CONFLICT (slug) DO UPDATE
        SET title = EXCLUDED.title,
            spec = EXCLUDED.spec,
            conversation_id = EXCLUDED.conversation_id,
            created_at = now()
     RETURNING id, slug`,
    [slug, s.title, JSON.stringify(s), input.conversationId],
  );
  const row = r.rows[0]!;
  await audit("agent", "generate_chart", row.slug, {
    conversationId: input.conversationId,
    type: s.type,
    rows: s.data.length,
  });

  return {
    ok: true,
    slug: row.slug,
    title: s.title,
    type: s.type,
    preview_url: `/api/charts/${row.slug}`,
  };
}

function sanitizeSlug(raw: string): string | null {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return /^[a-z0-9][a-z0-9-]{1,80}$/.test(s) ? s : null;
}
