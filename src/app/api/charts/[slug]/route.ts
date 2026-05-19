import { NextRequest, NextResponse } from "next/server";
import { catalogPool } from "@/lib/catalog/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params;
  const r = await catalogPool.query<{ slug: string; title: string; spec: unknown }>(
    `SELECT slug, title, spec FROM charts WHERE slug = $1`,
    [slug],
  );
  const row = r.rows[0];
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ chart: row });
}
