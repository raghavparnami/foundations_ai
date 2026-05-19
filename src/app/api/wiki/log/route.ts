import { NextRequest, NextResponse } from "next/server";
import { catalogPool } from "@/lib/catalog/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const domain = req.nextUrl.searchParams.get("domain");
  const limit = Math.min(50, Number(req.nextUrl.searchParams.get("limit") ?? 30));
  const r = await catalogPool.query<{
    ts: string;
    kind: string;
    target_kind: string | null;
    target_slug: string | null;
    domain_slug: string | null;
    summary: string;
  }>(
    domain
      ? `SELECT ts::text, kind, target_kind, target_slug, domain_slug, summary
           FROM wiki_log WHERE domain_slug = $1 ORDER BY ts DESC LIMIT $2`
      : `SELECT ts::text, kind, target_kind, target_slug, domain_slug, summary
           FROM wiki_log ORDER BY ts DESC LIMIT $1`,
    domain ? [domain, limit] : [limit],
  );
  return NextResponse.json({ entries: r.rows });
}
