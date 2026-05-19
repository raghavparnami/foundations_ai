/**
 * Wiki retrieval tools for the chat agent.
 *
 * The shift these implement: instead of dumping the full catalog (every
 * table, every view) into the system prompt and asking the agent to brute-
 * force which is relevant, the system prompt now shows only DOMAINS
 * (4-7 named knowledge areas). The agent picks the relevant domain and uses
 * `browse_wiki` to get its concrete contents — a much tighter retrieval.
 *
 * `search_wiki` is the escape hatch: when the user's question doesn't fit
 * cleanly into a single domain (or no domain is obviously relevant), the
 * agent runs a full-text-ish search across all wiki pages.
 */
import { tool } from "ai";
import { z } from "zod";
import { catalogPool } from "../catalog/db";
import { audit } from "../catalog/queries";

export function wikiTools(opts: { conversationId: string }) {
  return {
    browse_wiki: tool({
      description:
        "Pull a domain's full wiki index — its description, all member tables/views/skills/docs, and any concept pages. Call this FIRST when a question fits a domain you saw in the prompt. Returns enough context to write SQL without inspecting every table.",
      inputSchema: z.object({
        domain_slug: z
          .string()
          .describe("The domain slug from the catalog index (e.g. 'quality-deviations')."),
      }),
      execute: async ({ domain_slug }) => {
        await audit("agent", "tool:browse_wiki", domain_slug, { conversationId: opts.conversationId });
        const dom = await catalogPool.query<{
          id: number;
          slug: string;
          name: string;
          description: string | null;
        }>(
          `SELECT id, slug, name, description FROM wiki_domains WHERE slug = $1`,
          [domain_slug],
        );
        const d = dom.rows[0];
        if (!d) {
          return {
            error: `No domain named "${domain_slug}". Use search_wiki instead if you don't know which domain fits.`,
          };
        }
        const indexPage = await catalogPool.query<{ slug: string; body_md: string }>(
          `SELECT slug, body_md FROM wiki_pages
            WHERE domain_id = $1 AND page_type = 'index'
            ORDER BY updated_at DESC LIMIT 1`,
          [d.id],
        );
        const members = await catalogPool.query<{
          slug: string;
          title: string;
          summary: string | null;
          corpus: string | null;
          page_type: string;
        }>(
          `SELECT slug, title, summary, corpus, page_type
             FROM wiki_pages
            WHERE domain_id = $1 AND page_type IN ('source','concept')
            ORDER BY corpus, title`,
          [d.id],
        );
        return {
          domain: { slug: d.slug, name: d.name, description: d.description },
          index_page_body_md: indexPage.rows[0]?.body_md ?? null,
          members: members.rows,
        };
      },
    }),

    search_wiki: tool({
      description:
        "Search the wiki for pages matching a query. Use this when no single domain obviously fits the user's question, OR when you need to find a specific concept that might be in any domain. Returns up to 10 pages with their slug, title, summary, and the domain they belong to.",
      inputSchema: z.object({
        query: z
          .string()
          .min(2)
          .describe("Search terms. Matches against page title, summary, and body."),
      }),
      execute: async ({ query }) => {
        await audit("agent", "tool:search_wiki", null, { conversationId: opts.conversationId, query: query.slice(0, 200) });
        // Lightweight LIKE search; FTS index is in the plan but not wired yet.
        const pattern = `%${query.replace(/[%_]/g, "")}%`;
        const r = await catalogPool.query<{
          slug: string;
          title: string;
          summary: string | null;
          page_type: string;
          corpus: string | null;
          domain_name: string | null;
          domain_slug: string | null;
        }>(
          `SELECT p.slug, p.title, p.summary, p.page_type, p.corpus,
                  d.name AS domain_name, d.slug AS domain_slug
             FROM wiki_pages p
             LEFT JOIN wiki_domains d ON d.id = p.domain_id
            WHERE p.title ILIKE $1 OR p.summary ILIKE $1 OR p.body_md ILIKE $1
            ORDER BY
              CASE WHEN p.title ILIKE $1 THEN 0
                   WHEN p.summary ILIKE $1 THEN 1
                   ELSE 2
              END,
              p.updated_at DESC
            LIMIT 10`,
          [pattern],
        );
        return { query, hits: r.rows };
      },
    }),

    open_wiki_page: tool({
      description:
        "Open a specific wiki page by its slug (e.g. 'public.deviations' or 'domain/quality-deviations'). Returns the full markdown body, its domain, and pages that link to it. Use this when you need the deep detail of a single source — e.g. to read the columns and common filter patterns before writing SQL.",
      inputSchema: z.object({
        slug: z.string().describe("Full wiki page slug."),
      }),
      execute: async ({ slug }) => {
        await audit("agent", "tool:open_wiki_page", slug, { conversationId: opts.conversationId });
        const r = await catalogPool.query<{
          slug: string;
          title: string;
          summary: string | null;
          body_md: string;
          page_type: string;
          corpus: string | null;
          domain_name: string | null;
          domain_slug: string | null;
        }>(
          `SELECT p.slug, p.title, p.summary, p.body_md, p.page_type, p.corpus,
                  d.name AS domain_name, d.slug AS domain_slug
             FROM wiki_pages p
             LEFT JOIN wiki_domains d ON d.id = p.domain_id
            WHERE p.slug = $1`,
          [slug],
        );
        if (!r.rows[0]) return { error: `No wiki page with slug "${slug}".` };
        const backlinks = await catalogPool.query<{ slug: string; title: string }>(
          `SELECT p.slug, p.title
             FROM wiki_links l JOIN wiki_pages p ON p.id = l.from_page_id
            WHERE l.to_slug = $1
            ORDER BY p.title LIMIT 20`,
          [slug],
        );
        return { page: r.rows[0], backlinks: backlinks.rows };
      },
    }),
  };
}
