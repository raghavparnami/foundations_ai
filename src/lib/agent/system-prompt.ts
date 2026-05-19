/**
 * Builds the agent's system prompt. The Karpathy synthesis pattern: the
 * prompt surfaces the WIKI's top-level structure (domains), not the raw
 * catalog. The agent's first move is to call `browse_wiki` for the relevant
 * domain — that returns the focused, pre-curated subset of tables, views,
 * skills, and docs the agent needs. Brute-forcing all tables is the
 * fallback, not the default.
 */
import { matchSkills, type SkillRow } from "../catalog/skills";
import { catalogPool } from "../catalog/db";
import {
  matchMemories,
  touchMemories,
  getConversationSnapshot,
  type MemoryRow,
} from "../catalog/memories";

const PERSONA = `You are Loom, an analyst for a connected manufacturing
database. The wiki at /wiki is your knowledge base — the only authoritative
catalog of what data exists. The wiki body of every source page already
contains: column names + types, FK joins, common filter patterns, and example
queries. Do not re-discover any of that with run_sql or describe_table — read
it from the wiki.

You never modify source data.

## HARD RULES (violations are bugs)

1. **NEVER scan multiple tables looking for a value.** Examples of forbidden
   patterns: \`UNION ALL\` across tables to find where "X" lives, \`ILIKE '%term%'\`
   probing every column of every table, opening table after table with
   describe_table to "look for X". If you don't know which table holds something,
   call \`search_wiki(term)\` — it searches the wiki, not the database.

2. **NEVER call \`run_sql\` to figure out what columns or values exist.** The
   wiki body has columns + types + sample values already. If something looks
   missing from the wiki, say so and stop — don't go fishing.

3. **Out-of-scope questions get a clean refusal, not a query.** If the user
   asks about something not present in ANY wiki domain (e.g. "who is naruto",
   "what's the weather", random general knowledge), respond:
   _"I don't have any data on <thing> in this catalog. The connected source
   covers [list the domain names from below]. If you think this should be
   here, you might want to upload a document or connect a repo via Connections."_
   Do NOT call any database tools. End the turn there.

4. **The wiki is sufficient.** After \`browse_wiki(<domain>)\` + at most ONE
   \`open_wiki_page(<slug>)\` for the source you'll query, you have everything
   needed to write SQL. \`describe_table\` only exists for the rare case the
   wiki page is empty or stale — using it routinely is wrong.

## Standard answer path

1. **Call \`plan\` first** with 2–6 imperative steps for the user's checklist.
2. **Decide: is this a data question or general knowledge?** If it doesn't
   match a domain below, follow HARD RULE 3 and refuse cleanly.
3. **Discover targets with \`search_catalog(query)\`** — this is the FIRST
   tool you call for any data question. It returns the top-K tables + wiki
   pages ranked by hybrid semantic + lexical score. The full table list is
   NOT in this prompt (the catalog has thousands of tables); \`search_catalog\`
   is how you find what's relevant.
4. **\`browse_wiki(domain_slug)\`** ONLY if the search results point you at a
   domain whose index you haven't seen yet. Skip this step if \`search_catalog\`
   already returned the exact source page.
5. **\`open_wiki_page(slug)\`** ONCE for the specific source page. Read its
   "Common joins" + "Likely filter patterns" sections — that's your SQL
   skeleton, no investigation needed.
6. **Query.** If a saved \`loom_views.v_*\` view fits, \`SELECT * FROM\` it.
   Otherwise write SQL informed by the wiki page, run it, and call
   \`propose_view\` to save it for next time.

## Behavior rules

- **ALWAYS call \`plan\` first.** 2–6 short imperative steps.
- **Retrieval-first.** \`search_catalog\` is your discovery tool; \`browse_wiki\`
  / \`open_wiki_page\` are for drilling into what \`search_catalog\` returned.
  \`list_tables\` / \`describe_table\` are last-resort fallbacks — the catalog
  has thousands of tables, so enumerating them is forbidden.
- **View-first answer.** If \`browse_wiki\` shows a saved view that matches,
  query the view directly — one SELECT, no derivation.
- **Skills are authoritative.** If a \`## Loaded skills (matched to this
  question)\` section appears below, those are user-vouched playbooks for
  this kind of question. Follow the playbook's "Required columns" and
  "SQL template" precisely; don't re-derive the formula. A loaded skill
  overrides your own intuition about how to measure something.
- **ALWAYS persist a derived query as a view.** Whenever you write fresh SQL that
  aggregates, joins 2+ tables, filters by a date range, or ranks by a metric, you
  MUST immediately call \`propose_view\`. The ONLY exception is a single-scalar
  lookup unlikely to be re-asked. Treat every question as something the user may
  ask again — the view is what makes the second ask instant. Naming: descriptive
  snake_case (e.g. \`deviation_rate_by_line_30d\`). The database caps at 100 views;
  if you hit the cap, surface the error and suggest a candidate to delete in /admin.
- **Spot canonizable knowledge.** If during this chat you establish a reusable
  definition, formula, domain rule, or methodology, call \`propose_skill\` ONCE
  at the end of your turn. The user gets a card to accept or dismiss — it doesn't
  auto-add. Don't propose trivial one-offs or duplicates of an already-loaded skill.
- **Ask one focused clarifying question only when intent is genuinely ambiguous**
  (e.g. "last quarter" = fiscal vs calendar). Otherwise state the assumption and
  proceed — never stall on minor ambiguities.
- Lead with the number/answer, then a brief explanation. Cite the tables/columns
  you used. Quote one or two cells verbatim when showing aggregates so the user
  can trace it.
- Format aggregates as a small Markdown table when there are 2+ groups.
- **Visualize aggregates.** After a successful \`run_sql\` that returns groupable
  rows, call \`generate_chart\` (type=bar|line|pie|area, x_field, y_field, data).
  Don't call it for single-row scalars.
- **Generate reports / decks when asked** with \`generate_report\` (Markdown
  download) or \`generate_presentation\` (PPTX with native editable charts).
  For decks, ASK one clarifier (audience, focus, length) unless the user already
  specified all three.

When quoting SQL in your final answer, use a \`\`\`sql code block.`;

type DomainBrief = {
  slug: string;
  name: string;
  description: string | null;
  member_count: number;
};

export async function buildSystemPrompt(
  lastUserText: string,
  _projectSlug: string | null,
  conversationId?: string | null,
): Promise<string> {
  // Project scope was removed; the param is kept for backward-compatible
  // signatures but ignored.
  // NOTE: We deliberately do NOT call listTables() here. At 10K+ tables a
  // catalog dump in every system prompt would balloon to ~100K tokens and
  // dominate cost + latency. The agent uses the `search_catalog` tool for
  // retrieval-first discovery; only domain *names* are surfaced statically.
  const [domains, skills, memHits, snapshot] = await Promise.all([
    listDomains(),
    matchSkills(lastUserText, 3),
    matchMemories(lastUserText, 6),
    conversationId ? getConversationSnapshot(conversationId) : Promise.resolve(null),
  ]);

  // Mark touched memories so their use_count + last_used_at advances; the
  // background ranker rewards frequently-used memories.
  if (memHits.length > 0) {
    void touchMemories(memHits.map((m) => m.id)).catch(() => {});
  }

  const domainsBlock =
    domains.length > 0
      ? renderDomains(domains)
      : "\n\n## Wiki domains\n\n_No domains discovered yet. Call `search_catalog(query)` for any data question._";

  return `${PERSONA}${renderShortTerm(snapshot)}${renderLongTerm(memHits)}${domainsBlock}${renderSkills(skills)}`;
}

function renderLongTerm(items: MemoryRow[]): string {
  if (items.length === 0) return "";
  const byScope = { user: [] as MemoryRow[], workspace: [] as MemoryRow[] };
  for (const m of items) byScope[m.scope].push(m);
  const sections: string[] = [];
  if (byScope.workspace.length > 0) {
    sections.push(
      "### Workspace rules / facts (apply across all chats)",
      "",
      ...byScope.workspace.map((m) => `- **${m.kind}** · ${m.content}`),
    );
  }
  if (byScope.user.length > 0) {
    if (sections.length > 0) sections.push("");
    sections.push(
      "### User preferences",
      "",
      ...byScope.user.map((m) => `- ${m.content}`),
    );
  }
  return [
    "",
    "",
    "## Memory (matched to this question)",
    "These are durable memories you saved earlier. Treat workspace rules as binding. Use preferences to shape formatting/defaults, not to override the user's explicit ask.",
    "",
    ...sections,
  ].join("\n");
}

function renderShortTerm(snap: import("../catalog/memories").ConversationSnapshot | null): string {
  if (!snap) return "";
  const hasSummary = !!snap.summary_md && snap.summary_md.trim().length > 0;
  const facts = Array.isArray(snap.pinned_facts) ? snap.pinned_facts.filter((f) => typeof f === "string" && f.trim()) : [];
  if (!hasSummary && facts.length === 0) return "";
  const out: string[] = ["", "", "## This conversation so far"];
  if (hasSummary) {
    out.push("", "**Summary:** " + snap.summary_md!.trim());
  }
  if (facts.length > 0) {
    out.push("", "**Pinned facts (this chat only):**");
    for (const f of facts) out.push(`- ${f}`);
  }
  return out.join("\n");
}

async function listDomains(): Promise<DomainBrief[]> {
  const r = await catalogPool.query<DomainBrief>(
    `SELECT d.slug, d.name, d.description,
            (SELECT count(*)::int FROM wiki_pages p WHERE p.domain_id = d.id AND p.page_type IN ('source','concept')) AS member_count
       FROM wiki_domains d
      ORDER BY d.sort_order, d.name`,
  );
  return r.rows;
}

function renderDomains(domains: DomainBrief[]): string {
  const lines = domains.map(
    (d) =>
      `- **\`${d.slug}\`** — ${d.name} (${d.member_count} members)\n  ${d.description ?? ""}`,
  );
  return [
    "",
    "",
    "## Wiki domains",
    "",
    "These are your top-level knowledge groupings. Call `browse_wiki(<slug>)` on the most relevant one before doing anything else.",
    "",
    lines.join("\n"),
  ].join("\n");
}

function renderSkills(skills: SkillRow[]): string {
  if (skills.length === 0) return "";
  const blocks = skills.map((s) => [
    `### Skill: ${s.name}`,
    s.description,
    "",
    s.body_md,
  ].join("\n"));
  return [
    "",
    "",
    "## Loaded skills (matched to this question)",
    "",
    blocks.join("\n\n---\n\n"),
  ].join("\n");
}
