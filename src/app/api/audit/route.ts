import { NextResponse } from "next/server";
import { recentAudit } from "@/lib/catalog/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await recentAudit(60);
  return NextResponse.json({ entries: rows });
}
