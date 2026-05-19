import { NextResponse } from "next/server";
import { listTables } from "@/lib/catalog/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const tables = await listTables();
  return NextResponse.json({
    tables: tables.map((t) => ({
      id: t.id,
      schema: t.schema_name,
      name: t.table_name,
      row_count: Number(t.row_count ?? 0),
      column_count: t.column_count,
      status: t.status,
      profiled_at: t.last_profiled_at,
      enriched_at: t.last_enriched_at,
      source: t.source_name,
    })),
  });
}
