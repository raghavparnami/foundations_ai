/**
 * Domain index builder.
 *
 * For each row in `wiki_domains`, synthesize a landing page (page_type=
 * 'index') under slug `domain/<slug>`. The page is generated from:
 *   - The domain's description
 *   - Its members (every wiki_page row with this domain_id), grouped by
 *     corpus
 *   - Recent log entries for the domain
 *
 * Cross-links: the page links to every member via [[<slug>]]. The link
 * resolver picks these up so the bidirectional backlinks panel renders.
 */
import { catalogPool } from "../../catalog/db";
import { upsertWikiPage } from "../../catalog/wiki";

const ACTOR = "wiki-agent:domain-index";

type DomainRow = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  color: string | null;
};

type MemberRow = {
  id: number;
  kind: string;
  slug: string;
  title: string;
  summary: string | null;
  corpus: string | null;
};

export async function runDomainIndexBuilder(): Promise<{ generated: number }> {
  const domains = await catalogPool.query<DomainRow>(
    `SELECT id, slug, name, description, color FROM wiki_domains ORDER BY sort_order, name`,
  );

  let generated = 0;
  for (const d of domains.rows) {
    const body = await renderDomainIndex(d);
    const slug = `domain/${d.slug}`;
    const r = await upsertWikiPage(ACTOR, {
      kind: "tables", // legacy column; new page_type below is the real axis
      slug,
      title: d.name,
      summary: d.description,
      body_md: body,
      source_ref: { domain_id: d.id },
    });
    // Mark as a true domain-index page + tag with the domain itself.
    await catalogPool.query(
      `UPDATE wiki_pages
          SET page_type = 'index',
              domain_id = $2,
              corpus = 'mixed'
        WHERE id = $1`,
      [r.id, d.id],
    );
    if (r.action !== "skipped") generated++;
  }
  return { generated };
}

async function renderDomainIndex(d: DomainRow): Promise<string> {
  const members = await catalogPool.query<MemberRow>(
    `SELECT id, kind, slug, title, summary, corpus
       FROM wiki_pages
      WHERE domain_id = $1 AND page_type IN ('source','concept')
      ORDER BY corpus, title`,
    [d.id],
  );

  const grouped = new Map<string, MemberRow[]>();
  for (const m of members.rows) {
    const corpus = (m.corpus ?? guessCorpus(m.kind, m.slug)) || "other";
    const arr = grouped.get(corpus) ?? [];
    arr.push(m);
    grouped.set(corpus, arr);
  }

  // Recent log entries for this domain.
  const logRows = await catalogPool.query<{
    ts: string;
    kind: string;
    summary: string;
    target_slug: string | null;
  }>(
    `SELECT ts::text AS ts, kind, summary, target_slug
       FROM wiki_log
      WHERE domain_slug = $1
      ORDER BY ts DESC
      LIMIT 8`,
    [d.slug],
  );

  const parts: string[] = [];
  parts.push(`# ${d.name}`);
  parts.push("");
  if (d.description) parts.push(`> ${d.description}`);
  parts.push("");
  parts.push(`**${members.rowCount ?? 0} pages in this domain** · last refreshed ${new Date().toISOString().slice(0, 10)}`);
  parts.push("");

  if ((members.rowCount ?? 0) === 0) {
    parts.push("_No pages assigned to this domain yet. The next ingestion cycle will populate it._");
  } else {
    for (const [corpus, items] of grouped) {
      parts.push(`## ${corpusHeading(corpus)} (${items.length})`);
      parts.push("");
      for (const m of items) {
        const link = `[[${m.slug}]]`;
        const sub = m.summary ? ` — ${m.summary}` : "";
        parts.push(`- ${link}${sub}`);
      }
      parts.push("");
    }
  }

  if ((logRows.rowCount ?? 0) > 0) {
    parts.push("## Recent activity");
    parts.push("");
    for (const r of logRows.rows) {
      const ts = r.ts.slice(0, 16).replace("T", " ");
      parts.push(`- \`${ts}\` · **${r.kind}** · ${r.summary}`);
    }
    parts.push("");
  }

  return parts.join("\n");
}

function guessCorpus(_kind: string, slug: string): string {
  if (slug.startsWith("tables/loom_views.")) return "views";
  if (slug.startsWith("tables/")) return "tables";
  if (slug.startsWith("docs/")) return "documents";
  if (slug.startsWith("code/")) return "code";
  if (slug.startsWith("skill") || slug.includes("skill")) return "skills";
  return "other";
}

function corpusHeading(corpus: string): string {
  switch (corpus) {
    case "tables":
      return "Tables";
    case "views":
      return "Saved views";
    case "documents":
      return "Documents";
    case "code":
      return "Code";
    case "skills":
      return "Skills";
    case "mixed":
      return "Mixed";
    default:
      return corpus[0]!.toUpperCase() + corpus.slice(1);
  }
}
