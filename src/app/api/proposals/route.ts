import { NextResponse } from "next/server";
import { catalogPool } from "@/lib/catalog/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const r = await catalogPool.query<{
    id: number;
    kind: string;
    name: string;
    description: string | null;
    sql: string;
    status: string;
    created_at: string;
  }>(`SELECT id, kind, name, description, sql, status, created_at
        FROM proposals ORDER BY created_at DESC LIMIT 50`);
  return NextResponse.json({ proposals: r.rows });
}
