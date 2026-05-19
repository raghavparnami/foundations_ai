import { NextRequest } from "next/server";
import { catalogPool } from "@/lib/catalog/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params;
  const r = await catalogPool.query<{ title: string; body_md: string }>(
    `SELECT title, body_md FROM reports WHERE slug = $1`,
    [slug],
  );
  const row = r.rows[0];
  if (!row) return new Response("not found", { status: 404 });
  const filename = `${slug}.md`;
  return new Response(row.body_md, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
