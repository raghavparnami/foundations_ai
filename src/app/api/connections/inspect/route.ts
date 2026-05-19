/**
 * Inspect a Postgres connection — list the schemas and tables it exposes
 * BEFORE the user commits to ingesting it. The user then picks which
 * tables to include in the catalog. We do not persist the connection
 * during inspection — only on the subsequent POST /api/connections.
 *
 * Safety:
 *   - Read-only — only queries information_schema.
 *   - 10-second timeout so a hostile URL can't hang the request.
 *   - Closes the pool immediately to avoid leaking connections to an
 *     untrusted source.
 */
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM_SCHEMAS = ["pg_catalog", "information_schema", "pg_toast", "loom_views"];

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { conn_url?: string };
  const url = body.conn_url?.trim();
  if (!url) return NextResponse.json({ error: "conn_url required" }, { status: 400 });
  if (!/^postgres(ql)?:\/\//i.test(url)) {
    return NextResponse.json({ error: "only postgres:// URLs supported" }, { status: 400 });
  }

  const pool = new Pool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 10_000,
  });
  try {
    const r = await pool.query<{
      table_schema: string;
      table_name: string;
      table_type: string;
      row_estimate: string;
      n_columns: string;
    }>(
      `SELECT t.table_schema,
              t.table_name,
              t.table_type,
              COALESCE(c.reltuples::bigint::text, '0')           AS row_estimate,
              (SELECT count(*)::text FROM information_schema.columns ic
                WHERE ic.table_schema = t.table_schema AND ic.table_name = t.table_name) AS n_columns
         FROM information_schema.tables t
    LEFT JOIN pg_class c
           ON c.oid = (quote_ident(t.table_schema) || '.' || quote_ident(t.table_name))::regclass
        WHERE t.table_schema <> ALL($1::text[])
          AND t.table_type IN ('BASE TABLE', 'VIEW')
        ORDER BY t.table_schema, t.table_name`,
      [SYSTEM_SCHEMAS],
    );

    type SchemaGroup = {
      schema: string;
      tables: Array<{
        qualified: string;
        name: string;
        kind: "table" | "view";
        row_estimate: number;
        n_columns: number;
      }>;
    };
    const grouped = new Map<string, SchemaGroup>();
    for (const row of r.rows) {
      const arr = grouped.get(row.table_schema) ?? { schema: row.table_schema, tables: [] };
      arr.tables.push({
        qualified: `${row.table_schema}.${row.table_name}`,
        name: row.table_name,
        kind: row.table_type === "VIEW" ? "view" : "table",
        row_estimate: Number(row.row_estimate),
        n_columns: Number(row.n_columns),
      });
      grouped.set(row.table_schema, arr);
    }
    return NextResponse.json({
      ok: true,
      schemas: [...grouped.values()].sort((a, b) => a.schema.localeCompare(b.schema)),
      total_tables: r.rowCount ?? 0,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 502 },
    );
  } finally {
    await pool.end().catch(() => {});
  }
}
