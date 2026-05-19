import { NextRequest, NextResponse } from "next/server";
import { getDoc } from "@/lib/catalog/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ tableId: string }> },
) {
  const { tableId } = await ctx.params;
  const doc = await getDoc(Number(tableId));
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({
    table_id: doc.table_id,
    markdown: doc.markdown,
    provenance: doc.provenance,
    updated_at: doc.updated_at,
  });
}
