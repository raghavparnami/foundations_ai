import { NextRequest, NextResponse } from "next/server";
import { listWikiPages, type WikiKind } from "@/lib/catalog/wiki";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const k = req.nextUrl.searchParams.get("kind");
  const kind = (k && ["tables", "docs", "code"].includes(k) ? (k as WikiKind) : undefined);
  const pages = await listWikiPages(kind);
  return NextResponse.json({
    pages: pages.map((p) => ({
      id: p.id,
      kind: p.kind,
      slug: p.slug,
      title: p.title,
      summary: p.summary,
      status: p.status,
      updated_at: p.updated_at,
    })),
  });
}
