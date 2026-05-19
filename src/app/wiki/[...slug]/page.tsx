import { headers } from "next/headers";
import { notFound } from "next/navigation";
import WikiLayout from "@/components/wiki/WikiLayout";
import WikiPageView from "@/components/wiki/WikiPageView";
import type { Backlink, WikiPage } from "@/components/wiki/types";

export const dynamic = "force-dynamic";

async function fetchPage(slug: string): Promise<{ page: WikiPage; backlinks: Backlink[] } | null> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3001";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const r = await fetch(`${proto}://${host}/api/wiki/page?slug=${encodeURIComponent(slug)}`, {
    cache: "no-store",
  });
  if (!r.ok) return null;
  return r.json();
}

export default async function WikiSlugPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug: parts } = await params;
  const slug = parts.join("/");
  const data = await fetchPage(slug);
  if (!data) notFound();
  return (
    <WikiLayout activeSlug={slug}>
      <WikiPageView page={data.page} backlinks={data.backlinks} />
    </WikiLayout>
  );
}
