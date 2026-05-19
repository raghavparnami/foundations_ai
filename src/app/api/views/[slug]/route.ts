/**
 * Edit / delete a saved view.
 *
 *   GET    → return the proposal row (SQL + description)
 *   PATCH  → CREATE OR REPLACE with new SQL, re-register columns in catalog
 *   DELETE → DROP VIEW from source DB + remove from catalog + proposal
 *
 * Edit reuses the same `proposeView` path as the agent so column metadata
 * stays in sync with the source DB.
 */
import { NextRequest, NextResponse } from "next/server";
import { catalogPool, sourcePool } from "@/lib/catalog/db";
import { audit } from "@/lib/catalog/queries";
import { proposeView } from "@/lib/agent/propose-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCE_URL =
  process.env.LOOM_DEMO_SOURCE_URL ??
  "postgres://loom:loom@localhost:5544/loom_demo_source";
const VIEW_SCHEMA = "loom_views";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const r = await catalogPool.query<{
    id: number;
    name: string;
    description: string | null;
    sql: string;
    status: string;
    created_at: string;
  }>(
    `SELECT id, name, description, sql, status, created_at
       FROM proposals WHERE kind = 'view' AND name = $1`,
    [slug],
  );
  const row = r.rows[0];
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ view: row });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const body = (await req.json()) as { sql?: string; description?: string };
  const sql = body.sql?.trim();
  if (!sql) return NextResponse.json({ error: "sql is required" }, { status: 400 });

  // Reuse the propose-view path so column metadata + doc stay in sync.
  // Strip the leading `v_` because proposeView re-adds it.
  const baseName = slug.startsWith("v_") ? slug.slice(2) : slug;
  const r = await proposeView({
    name: baseName,
    sql,
    description: body.description,
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  await audit("user", "view:edit", r.qualified_name, { bytes: sql.length });
  return NextResponse.json({ view: r });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  // DROP VIEW in the source DB
  try {
    const pool = sourcePool(SOURCE_URL);
    await pool.query(`DROP VIEW IF EXISTS "${VIEW_SCHEMA}"."${slug.replace(/"/g, '""')}"`);
  } catch (e) {
    return NextResponse.json(
      { error: `Postgres rejected DROP VIEW: ${(e as Error).message}` },
      { status: 400 },
    );
  }

  // Remove from catalog tables (cascades to columns + docs)
  await catalogPool.query(
    `DELETE FROM tables WHERE schema_name = $1 AND table_name = $2`,
    [VIEW_SCHEMA, slug],
  );
  await catalogPool.query(`DELETE FROM proposals WHERE kind = 'view' AND name = $1`, [slug]);
  await audit("user", "view:delete", `${VIEW_SCHEMA}.${slug}`);

  return NextResponse.json({ ok: true });
}
