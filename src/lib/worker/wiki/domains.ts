/**
 * Domain discovery worker.
 *
 * Clusters the catalog's structured + unstructured artifacts into named
 * "domains" — the top-level navigation axis of the wiki. A domain cuts
 * across corpora: "Quality" might cover the `deviations` and `quality_checks`
 * tables, the `deviation-rate` skill, an uploaded QA runbook, and any code
 * module dealing with quality checks.
 *
 * Strategy:
 *   1. Gather signals: source tables, views, skills, currently-known docs,
 *      currently-known code modules.
 *   2. Ask the doc-writer LLM to cluster them into 3-7 domains. For each
 *      domain it returns: slug, name, one-sentence description, color, and
 *      the list of source slugs assigned to it.
 *   3. Upsert into `wiki_domains`. Hash-gated: if the cluster signature
 *      hasn't changed, skip.
 *   4. Tag every page that matches a domain's members with `domain_id`.
 *
 * Domain discovery runs on every wiki tick — but is hash-gated against the
 * set of (tables, views, skills, docs, code modules) so 99% of ticks are
 * no-ops.
 */
import { createHash } from "node:crypto";
import { generateObject } from "ai";
import { z } from "zod";
import { catalogPool } from "../../catalog/db";
import { docWriterModel } from "../openrouter";
import { audit } from "../../catalog/queries";

const ACTOR = "wiki-agent:domains";

type Signal = { kind: string; slug: string; label: string; description: string };

const DomainsSchema = z.object({
  domains: z
    .array(
      z.object({
        slug: z
          .string()
          .min(2)
          .max(40)
          .regex(/^[a-z][a-z0-9-]+$/, "must be lowercase kebab-case"),
        name: z.string().min(2).max(80),
        description: z.string().min(10).max(280),
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/, "must be 6-digit hex")
          .optional(),
        member_slugs: z
          .array(z.string())
          .min(1)
          .max(60)
          .describe(
            "List of source slugs from the input that belong to this domain. Use the EXACT slugs given. Each source should appear in exactly one domain.",
          ),
      }),
    )
    .min(2)
    .max(8),
});

export async function discoverDomains(): Promise<{
  changed: boolean;
  domains: { slug: string; name: string; members: number }[];
}> {
  const signals = await collectSignals();
  if (signals.length === 0) {
    return { changed: false, domains: [] };
  }

  const signature = createHash("md5")
    .update(signals.map((s) => `${s.kind}|${s.slug}`).sort().join("\n"))
    .digest("hex");

  const last = await catalogPool.query<{ value: string }>(
    `SELECT details->>'signature' AS value
       FROM audit_log
      WHERE actor = $1 AND action = 'domains:discover'
      ORDER BY ts DESC LIMIT 1`,
    [ACTOR],
  );
  if (last.rows[0]?.value === signature) {
    return { changed: false, domains: [] };
  }

  const result = await generateObject({
    model: docWriterModel(),
    schema: DomainsSchema,
    system: SYSTEM_PROMPT,
    prompt: renderPrompt(signals),
    maxRetries: 1,
  });

  // Upsert domains
  const seenSlugs = new Set<string>();
  const out: { slug: string; name: string; members: number }[] = [];
  for (const [i, d] of result.object.domains.entries()) {
    seenSlugs.add(d.slug);
    await catalogPool.query(
      `INSERT INTO wiki_domains (slug, name, description, color, sort_order, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (slug) DO UPDATE
          SET name = EXCLUDED.name,
              description = EXCLUDED.description,
              color = EXCLUDED.color,
              sort_order = EXCLUDED.sort_order,
              updated_at = NOW()`,
      [d.slug, d.name, d.description, d.color ?? null, i * 10],
    );
    // Resolve members → wiki_pages.domain_id
    const memberCount = await attachMembers(d.slug, d.member_slugs);
    out.push({ slug: d.slug, name: d.name, members: memberCount });
  }

  // Drop domains the LLM didn't include this round.
  if (seenSlugs.size > 0) {
    await catalogPool.query(
      `DELETE FROM wiki_domains WHERE slug <> ALL($1::text[])`,
      [[...seenSlugs]],
    );
  }

  await audit(ACTOR, "domains:discover", null, {
    signature,
    domains: out.length,
    signals: signals.length,
  });
  await catalogPool.query(
    `INSERT INTO wiki_log (kind, summary, details)
       VALUES ('regen', $1, $2::jsonb)`,
    [
      `discovered ${out.length} domain${out.length === 1 ? "" : "s"} from ${signals.length} signals`,
      JSON.stringify({ domains: out }),
    ],
  );

  return { changed: true, domains: out };
}

async function collectSignals(): Promise<Signal[]> {
  const out: Signal[] = [];

  // Tables (excluding views — views are derived, the agent will assign them
  // to their underlying tables' domain).
  const tables = await catalogPool.query<{
    schema_name: string;
    table_name: string;
    row_count: string | null;
  }>(
    `SELECT schema_name, table_name, row_count::text
       FROM tables
      WHERE schema_name <> 'loom_views'
      ORDER BY schema_name, table_name`,
  );
  for (const t of tables.rows) {
    out.push({
      kind: "table",
      slug: `${t.schema_name}.${t.table_name}`,
      label: `${t.schema_name}.${t.table_name}`,
      description: `Table${t.row_count ? ` · ${t.row_count} rows` : ""}`,
    });
  }

  // Skills
  const skills = await catalogPool.query<{
    slug: string;
    name: string;
    description: string;
  }>(
    `SELECT slug, name, description FROM skills WHERE enabled = TRUE ORDER BY slug`,
  );
  for (const s of skills.rows) {
    out.push({ kind: "skill", slug: `skill:${s.slug}`, label: s.name, description: s.description });
  }

  // Documents already ingested
  const docs = await catalogPool.query<{ id: number; display_name: string }>(
    `SELECT id, display_name FROM documents WHERE status = 'indexed' ORDER BY id`,
  );
  for (const d of docs.rows) {
    out.push({
      kind: "doc",
      slug: `doc:${d.id}`,
      label: d.display_name,
      description: "Uploaded document",
    });
  }

  // Code sources (each repo, not each module — domains decide later)
  const code = await catalogPool.query<{ id: number; display_name: string; project_path: string }>(
    `SELECT id, display_name, project_path FROM code_sources WHERE status = 'ready' ORDER BY id`,
  );
  for (const c of code.rows) {
    out.push({
      kind: "code",
      slug: `code:${c.id}`,
      label: c.display_name,
      description: c.project_path,
    });
  }

  return out;
}

async function attachMembers(domainSlug: string, memberSlugs: string[]): Promise<number> {
  const dom = await catalogPool.query<{ id: number }>(
    `SELECT id FROM wiki_domains WHERE slug = $1`,
    [domainSlug],
  );
  const domainId = dom.rows[0]?.id;
  if (!domainId) return 0;
  // Best-effort match: source pages have slugs like "tables/public.deviations"
  // or "docs/<slug>" or "code/<repo>-<module>" or "skills/<slug>".
  let count = 0;
  for (const m of memberSlugs) {
    const patterns = candidatePatterns(m);
    for (const pat of patterns) {
      const r = await catalogPool.query(
        `UPDATE wiki_pages SET domain_id = $1 WHERE slug = $2 OR slug LIKE $3`,
        [domainId, pat, `${pat}%`],
      );
      count += r.rowCount ?? 0;
      if ((r.rowCount ?? 0) > 0) break;
    }
  }
  return count;
}

function candidatePatterns(memberSlug: string): string[] {
  // Try a few resolutions — the LLM might return "public.deviations" or
  // "skill:deviation-rate" or just "deviations".
  const trimmed = memberSlug.replace(/^(skill|doc|code|table):/i, "");
  return [trimmed, `tables/${trimmed}`, trimmed.replace(/[^a-z0-9]/gi, "-").toLowerCase()];
}

const SYSTEM_PROMPT = `You are an information architect organizing a knowledge
base for a manufacturing operations team. Given a list of database tables,
saved metric definitions (skills), uploaded documents, and code repositories,
group them into 3-7 named DOMAINS — coherent business areas a plant manager
would recognize.

Good domain examples (manufacturing context):
  - "Production lifecycle" — runs, batches, throughput
  - "Quality & deviations" — defects, QC, root cause
  - "Equipment & maintenance" — assets, downtime, preventive maintenance
  - "Workforce" — operators, shifts, certifications
  - "Process documentation" — runbooks, SOPs, escalation paths

Rules:
- Domains must cover EVERY input slug exactly once (no orphans).
- Names are 2-4 words, written for an exec audience.
- Descriptions are one sentence (≤30 words) explaining what falls under it.
- Colors are subtle hex tints (#e6e8ff for blue-ish, #ffe6e6 for red-ish, etc).
  Choose deliberately — different domains should be visually distinguishable.
- Use the EXACT input slugs in member_slugs. Don't invent new ones.

Return ONLY the JSON matching the schema. No prose.`;

function renderPrompt(signals: Signal[]): string {
  const grouped = new Map<string, Signal[]>();
  for (const s of signals) {
    const arr = grouped.get(s.kind) ?? [];
    arr.push(s);
    grouped.set(s.kind, arr);
  }
  const sections: string[] = [];
  for (const [kind, items] of grouped) {
    sections.push(
      `## ${kind.toUpperCase()}S (${items.length})\n` +
        items.map((i) => `- ${i.slug} — ${i.label}: ${i.description}`).join("\n"),
    );
  }
  return [
    "Cluster the following catalog members into 3-7 domains.",
    "",
    ...sections,
  ].join("\n\n");
}
