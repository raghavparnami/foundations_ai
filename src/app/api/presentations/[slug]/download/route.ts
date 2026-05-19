import { NextRequest } from "next/server";
import { catalogPool } from "@/lib/catalog/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Presentations are persisted in `reports` with a `.pptx` slug. The body_md
 * column holds the base64-encoded binary. We decode and stream it.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params;
  const filename = slug.endsWith(".pptx") ? slug : `${slug}.pptx`;
  const r = await catalogPool.query<{ title: string; body_md: string }>(
    `SELECT title, body_md FROM reports WHERE slug = $1`,
    [filename],
  );
  const row = r.rows[0];
  if (!row) return new Response("not found", { status: 404 });
  const bin = Buffer.from(row.body_md, "base64");
  return new Response(bin, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(bin.length),
    },
  });
}
