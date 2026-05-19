import { NextResponse } from "next/server";
import { catalogPool } from "@/lib/catalog/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const r = await catalogPool.query<{
    id: number;
    slug: string;
    title: string;
    conversation_id: string | null;
    created_at: string;
    bytes: number;
  }>(`SELECT id, slug, title, conversation_id, created_at, length(body_md)::int AS bytes
        FROM reports ORDER BY created_at DESC LIMIT 50`);
  return NextResponse.json({ reports: r.rows });
}
