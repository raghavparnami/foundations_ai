import { NextRequest, NextResponse } from "next/server";
import { getWikiPage, getBacklinks, type WikiKind } from "@/lib/catalog/wiki";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ kind: string; slug: string }> },
) {
  const { kind, slug } = await ctx.params;
  if (!["tables", "docs", "code"].includes(kind)) {
    return NextResponse.json({ error: "invalid_kind" }, { status: 400 });
  }
  const page = await getWikiPage(kind as WikiKind, slug);
  if (!page) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const backlinks = await getBacklinks(kind as WikiKind, slug);
  return NextResponse.json({
    page: {
      id: page.id,
      kind: page.kind,
      slug: page.slug,
      title: page.title,
      summary: page.summary,
      body_md: page.body_md,
      source_ref: page.source_ref,
      status: page.status,
      generated_at: page.generated_at,
      updated_at: page.updated_at,
    },
    backlinks: backlinks.map((b) => ({
      kind: b.kind,
      slug: b.slug,
      title: b.title,
    })),
  });
}
