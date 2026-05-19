/**
 * Run-insights endpoint.
 *
 * Strategy: prefer rows that have been written to the `insights` table by a
 * future insight-extractor worker; if the table is empty (demo state), fall
 * back to deriving insights on-the-fly from saved views in `loom_views`.
 *
 * Either way we return rows that match the `insights` table shape so the UI
 * widget doesn't need to branch on source.
 */
import { NextResponse } from "next/server";
import { catalogPool, sourcePool } from "@/lib/catalog/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCE_URL =
  process.env.LOOM_DEMO_SOURCE_URL ??
  "postgres://loom:loom@localhost:5544/loom_demo_source";

type Insight = {
  id: number;
  view_slug: string;
  headline: string;
  body: string | null;
  importance: number;
  created_at: string;
};

export async function GET() {
  // 1. Real insights from the persisted table, ranked by importance.
  const persisted = await catalogPool.query<Insight>(
    `SELECT id, view_slug, headline, body, importance, created_at::text AS created_at
       FROM insights
      ORDER BY importance DESC, created_at DESC
      LIMIT 8`,
  );
  if (persisted.rowCount && persisted.rowCount > 0) {
    return NextResponse.json({ insights: persisted.rows });
  }

  // 2. Fallback: derive insights on-the-fly from saved views.
  const insights = await deriveFromViews();
  return NextResponse.json({ insights });
}

async function deriveFromViews(): Promise<Insight[]> {
  const out: Insight[] = [];
  const now = new Date().toISOString();

  // System-level insight always shipped.
  const sys = await catalogPool.query<{ ready: string; total: string }>(
    `SELECT count(*) FILTER (WHERE status='ready')::text AS ready,
            count(*)::text AS total
       FROM tables`,
  );
  out.push({
    id: -1,
    view_slug: "system",
    headline: `${sys.rows[0]?.ready ?? 0} of ${sys.rows[0]?.total ?? 0} tables profiled & documented`,
    body: "Catalog readiness across all sources.",
    importance: 2,
    created_at: now,
  });

  // Per-view top row insight.
  const proposals = await catalogPool.query<{ name: string; description: string | null; created_at: string }>(
    `SELECT name, description, created_at::text AS created_at
       FROM proposals WHERE kind='view' ORDER BY created_at DESC LIMIT 6`,
  );

  const pool = sourcePool(SOURCE_URL);
  let id = -100;
  for (const p of proposals.rows) {
    try {
      const r = await pool.query<Record<string, unknown>>(
        `SELECT * FROM "loom_views"."${p.name}" LIMIT 1`,
      );
      const row = r.rows[0];
      if (!row) continue;
      out.push({
        id: id--,
        view_slug: p.name,
        headline: formatRow(row),
        body: p.description,
        importance: 3,
        created_at: p.created_at,
      });
    } catch {
      // Broken view (e.g. underlying column dropped) — silently skip.
    }
  }

  // View count summary.
  if (proposals.rowCount && proposals.rowCount > 0) {
    out.unshift({
      id: -200,
      view_slug: "system",
      headline: `${proposals.rowCount} saved view${proposals.rowCount === 1 ? "" : "s"} auto-built by Loom`,
      body: "Each one is a real Postgres view; query directly with SELECT * FROM loom_views.<name>.",
      importance: 3,
      created_at: now,
    });
  }

  // Recent agent activity.
  const recent = await catalogPool.query<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM audit_log
      WHERE action='tool:run_sql' AND ts > now() - interval '24 hours'`,
  );
  const n = Number(recent.rows[0]?.n ?? 0);
  if (n > 0) {
    out.push({
      id: -2,
      view_slug: "system",
      headline: `${n} queries answered today`,
      body: "All from the live catalog + saved views.",
      importance: 1,
      created_at: now,
    });
  }

  return out.slice(0, 8);
}

function formatRow(row: Record<string, unknown>): string {
  const entries = Object.entries(row).slice(0, 3);
  return entries.map(([k, v]) => `${k}: ${formatValue(v)}`).join(" · ");
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") {
    return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(3);
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return s.length > 40 ? s.slice(0, 40) + "…" : s;
}
