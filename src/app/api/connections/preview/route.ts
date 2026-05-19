/**
 * Preview the tables visible at a Postgres connection URL — read-only,
 * doesn't touch the catalog. Used by the Connections form so the user can
 * pick which tables to include before they hit Connect.
 *
 * Snowflake / Databricks will land their own preview handlers in v0.5.
 */
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PreviewRow = {
  schema_name: string;
  table_name: string;
  table_type: "BASE TABLE" | "VIEW";
  estimated_rows: number;
};

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { kind?: string; conn_url?: string };
  const kind = body.kind ?? "postgres";
  const url = body.conn_url?.trim();
  if (!url) return NextResponse.json({ error: "conn_url required" }, { status: 400 });

  if (kind !== "postgres") {
    return NextResponse.json({
      error:
        `Preview for ${kind} lands in v0.5. The connection will still save and projects can reference it.`,
      stub: true,
    }, { status: 501 });
  }

  let pool: Pool | null = null;
  try {
    pool = new Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 4000 });
    const r = await pool.query<PreviewRow>(
      `SELECT
         t.table_schema AS schema_name,
         t.table_name,
         t.table_type,
         COALESCE(
           (SELECT reltuples::bigint FROM pg_class
              WHERE oid = (t.table_schema || '.' || t.table_name)::regclass),
           0
         )::int AS estimated_rows
       FROM information_schema.tables t
       WHERE t.table_schema NOT IN ('pg_catalog','information_schema','loom_views')
         AND t.table_type IN ('BASE TABLE','VIEW')
       ORDER BY t.table_schema, t.table_name`,
    );
    return NextResponse.json({
      tables: r.rows.map((row) => ({
        schema: row.schema_name,
        name: row.table_name,
        kind: row.table_type === "VIEW" ? "view" : "table",
        estimated_rows: Number(row.estimated_rows),
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Could not connect: ${(e as Error).message}` },
      { status: 502 },
    );
  } finally {
    if (pool) await pool.end().catch(() => {});
  }
}
