/**
 * Single-page fetch by full slug (incl. path).
 *
 * Returns the page row, resolved backlinks, sibling pages in the same
 * domain, and the domain's breadcrumb.
 */
import { NextRequest, NextResponse } from "next/server";
import { catalogPool } from "@/lib/catalog/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageRow = {
  id: number;
  kind: string;
  slug: string;
  title: string;
  summary: string | null;
  body_md: string;
  page_type: string;
  corpus: string | null;
  domain_id: number | null;
  domain_slug: string | null;
  domain_name: string | null;
  status: string;
  updated_at: string;
  generated_at: string | null;
};

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug");
  if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });

  const r = await catalogPool.query<PageRow>(
    `SELECT p.id, p.kind, p.slug, p.title, p.summary, p.body_md, p.page_type,
            p.corpus, p.domain_id, d.slug AS domain_slug, d.name AS domain_name,
            p.status, p.updated_at::text AS updated_at, p.generated_at::text AS generated_at
       FROM wiki_pages p
       LEFT JOIN wiki_domains d ON d.id = p.domain_id
      WHERE p.slug = $1`,
    [slug],
  );
  const page = r.rows[0];
  if (!page) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const backlinks = await catalogPool.query<{
    slug: string;
    title: string;
    summary: string | null;
    page_type: string;
    domain_slug: string | null;
    domain_name: string | null;
  }>(
    `SELECT p.slug, p.title, p.summary, p.page_type,
            d.slug AS domain_slug, d.name AS domain_name
       FROM wiki_links l
       JOIN wiki_pages p ON p.id = l.from_page_id
       LEFT JOIN wiki_domains d ON d.id = p.domain_id
      WHERE l.to_slug = $1 OR l.to_slug = $2
      ORDER BY p.title`,
    [slug, slug.replace(/^[a-z]+\//, "")],
  );

  let siblings: { slug: string; title: string; page_type: string }[] = [];
  if (page.domain_id != null) {
    const s = await catalogPool.query<{ slug: string; title: string; page_type: string }>(
      `SELECT slug, title, page_type
         FROM wiki_pages
        WHERE domain_id = $1 AND id <> $2
        ORDER BY page_type, title
        LIMIT 30`,
      [page.domain_id, page.id],
    );
    siblings = s.rows;
  }

  return NextResponse.json({
    page,
    backlinks: backlinks.rows,
    siblings,
  });
}
