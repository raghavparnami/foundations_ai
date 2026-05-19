import { NextRequest, NextResponse } from "next/server";
import { catalogPool } from "@/lib/catalog/db";
import { audit } from "@/lib/catalog/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sources = await catalogPool.query<{
    id: number;
    name: string;
    kind: string;
    conn_url: string;
    created_at: string;
    total: string;
    ready: string;
  }>(`
    SELECT s.id, s.name, s.kind, s.conn_url, s.created_at,
           (SELECT count(*)::text FROM tables t WHERE t.source_id = s.id) AS total,
           (SELECT count(*)::text FROM tables t WHERE t.source_id = s.id AND t.status = 'ready') AS ready
      FROM sources s
     ORDER BY s.id
  `);
  return NextResponse.json({
    sources: sources.rows.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      conn_url: redact(s.conn_url),
      created_at: s.created_at,
      total_tables: Number(s.total),
      ready_tables: Number(s.ready),
    })),
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    name?: string;
    kind?: string;
    conn_url?: string;
    included_tables?: string[]; // qualified "schema.name" strings; empty = ALL
  };
  if (!body.name || !body.conn_url) {
    return NextResponse.json({ error: "name and conn_url required" }, { status: 400 });
  }
  const included = Array.isArray(body.included_tables) && body.included_tables.length > 0
    ? body.included_tables.filter((s) => typeof s === "string" && s.includes("."))
    : null;
  const r = await catalogPool.query<{ id: number }>(
    `INSERT INTO sources (name, kind, conn_url, included_tables)
       VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (name) DO UPDATE
        SET conn_url = EXCLUDED.conn_url,
            included_tables = EXCLUDED.included_tables
     RETURNING id`,
    [body.name, body.kind ?? "postgres", body.conn_url, included ? JSON.stringify(included) : null],
  );
  await audit("user", "connection:add", body.name, {
    included: included ? included.length : "all",
  });
  return NextResponse.json({ id: r.rows[0]!.id, name: body.name, included_tables: included });
}

function redact(url: string): string {
  return url.replace(/(:\/\/[^:]+:)([^@]+)(@)/, "$1•••$3");
}
