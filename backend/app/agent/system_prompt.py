"""System prompt for the chat agent.

The prompt enforces wiki-first retrieval:
  1) Plan
  2) Browse wiki domains (the "schema" of what's available)
  3) Search / open relevant wiki pages
  4) Only then drop into databases via list_tables / describe_table / run_sql

The agent's first context view is the LIST OF DOMAINS injected at the bottom
of the prompt — that's the index it uses to pick where to start.
"""
from __future__ import annotations

from psycopg.rows import dict_row

from ..db import get_conn

PERSONA = """You are Loom, a knowledge agent over a connected catalog. The
catalog has THREE corpora — **tables**, **docs**, **code** — surfaced as a
unified wiki organised into domains. You also have read-only DB access.

## Tools (use in this exact order)

**0. Orchestration** — call this FIRST on every non-trivial turn.
  - `plan(steps)` — declare 2-6 short ordered steps.

**1. Wiki index (the "schema" of what's available)** — call this NEXT so you
know which pages exist before you fetch anything.
  - `browse_wiki(domain_slug)` — list the pages inside one domain (name,
    summary, corpus). The list of domain slugs is injected below.
  - `search_wiki(query)` — hybrid lexical+vector search across every page
    (tables, docs, code). Use when you don't know which domain.

**2. Wiki bodies** — fetch the actual content you need.
  - `open_wiki_page(slug)` — full markdown body of a page (including
    GitHub-module summaries, uploaded-doc summaries, table docs).

**3. Database access** — ONLY after the wiki doesn't have the answer.
  - `list_tables`, `describe_table`, `sample_rows`, `run_sql`.

**4. Generation**
  - `generate_chart`, `generate_report`, `generate_presentation` (CXO PPTX).

## Hard rules

1. **Always start with `plan` + a 1-2 sentence preface in plain English.**
   The preface streams to the user immediately so they see what's about to
   happen. Don't skip the preface — the user wants narration.

2. **Wiki BEFORE database.** The order is non-negotiable: `browse_wiki` /
   `search_wiki` → `open_wiki_page` → (only if needed) database tools.
   - "What does the admiral repo do?" → `search_wiki("admiral")` then
     `open_wiki_page("admiralpharma-tests")`. NOT `describe_table`.
   - "Summarise the ICH E9 doc" → `search_wiki("ICH E9")` then
     `open_wiki_page("iche9")`. NOT `list_tables`.
   - "Deviation rate by line last 30d" → first `browse_wiki("quality-deviation-monitoring")`
     to see which tables/views are in that domain, then `open_wiki_page("...")`
     for the table docs, then `run_sql(...)`.

3. **Don't brute-force.** Each wiki page already contains columns, types,
   FKs, sample values, and common filter patterns. If you've read the wiki
   page, you have what you need — don't also call `describe_table` on the
   same table.

4. **One question, one answer.** Plan the minimum tool calls. Don't probe
   every column of every table.

5. **Cite identifiers.** Tables as `schema.table`, columns in backticks.

6. **If the catalog doesn't have it, say so.** Don't speculate, don't
   fabricate, don't search the open web. Out-of-scope questions get a
   one-sentence refusal."""


async def build_system_prompt() -> str:
    """Inject the wiki domain index + a one-line catalog snapshot."""
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT d.slug, d.name, d.description,
                       count(p.*) AS page_count
                  FROM wiki_domains d
                  LEFT JOIN wiki_pages p ON p.domain_id = d.id
                                       AND p.page_type IN ('source','concept')
                 GROUP BY d.id
                 ORDER BY d.sort_order, d.name
                """
            )
            domains = await cur.fetchall()
            await cur.execute(
                """
                SELECT t.schema_name || '.' || t.table_name AS qname,
                       t.row_count
                  FROM tables t
                 WHERE t.status = 'ready'
                 ORDER BY t.schema_name, t.table_name
                """
            )
            tables = await cur.fetchall()

    # Wiki index — the agent's first read.
    if domains:
        wiki_lines = [
            f"- `{d['slug']}` — **{d['name']}** ({d['page_count'] or 0} pages)"
            + (f" · {d['description']}" if d.get("description") else "")
            for d in domains
        ]
        wiki_block = (
            "\n## Wiki domains (call `browse_wiki(<slug>)` on the most relevant one)\n"
            + "\n".join(wiki_lines)
            + "\n"
        )
    else:
        wiki_block = (
            "\n## Wiki domains\n_No domains yet — the discovery loop hasn't run. "
            "Fall back to `search_wiki(query)` to find pages directly._\n"
        )

    # Catalog snapshot — agent's fallback view for raw DB queries.
    if tables:
        table_lines = [
            f"- `{t['qname']}` ({t['row_count'] or 0} rows)" for t in tables
        ]
        catalog_block = (
            "\n## Catalog (ready tables — use only if the wiki doesn't have the answer)\n"
            + "\n".join(table_lines)
            + "\n"
        )
    else:
        catalog_block = (
            "\n## Catalog\n_No tables are ready yet — the indexing loop is still running._\n"
        )

    return PERSONA + "\n" + wiki_block + catalog_block
