/**
 * Wiki tree endpoint — returns the navigation structure organized by
 * domain, not by corpus.
 *
 * Shape:
 *   {
 *     domains: [
 *       { slug, name, description, color, page_count,
 *         index_slug,                       // the "domain/<slug>" page itself
 *         pages: [{ slug, title, summary, page_type, corpus }]
 *       },
 *       ...
 *     ],
 *     unassigned: [{ slug, title, ... }]    // pages not yet in any domain
 *   }
 */
import { NextResponse } from "next/server";
import { catalogPool } from "@/lib/catalog/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DomainRow = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  color: string | null;
};

type PageRow = {
  domain_id: number | null;
  slug: string;
  title: string;
  summary: string | null;
  page_type: string;
  corpus: string | null;
};

export async function GET() {
  const domains = await catalogPool.query<DomainRow>(
    `SELECT id, slug, name, description, color
       FROM wiki_domains
      ORDER BY sort_order, name`,
  );
  const pages = await catalogPool.query<PageRow>(
    `SELECT domain_id, slug, title, summary, page_type, corpus
       FROM wiki_pages
      ORDER BY corpus, title`,
  );

  const byDomain = new Map<number, PageRow[]>();
  const unassigned: PageRow[] = [];
  for (const p of pages.rows) {
    if (p.domain_id == null) {
      unassigned.push(p);
    } else {
      const arr = byDomain.get(p.domain_id) ?? [];
      arr.push(p);
      byDomain.set(p.domain_id, arr);
    }
  }

  const out = domains.rows.map((d) => {
    const all = byDomain.get(d.id) ?? [];
    const indexPage = all.find((p) => p.page_type === "index");
    const otherPages = all.filter((p) => p.page_type !== "index");
    return {
      id: d.id,
      slug: d.slug,
      name: d.name,
      description: d.description,
      color: d.color,
      index_slug: indexPage?.slug ?? null,
      page_count: otherPages.length,
      pages: otherPages.map(stripDomain),
    };
  });

  return NextResponse.json({
    domains: out,
    unassigned: unassigned.map(stripDomain),
  });
}

function stripDomain(p: PageRow) {
  return {
    slug: p.slug,
    title: p.title,
    summary: p.summary,
    page_type: p.page_type,
    corpus: p.corpus,
  };
}
