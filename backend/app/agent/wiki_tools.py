"""Wiki retrieval tools for the chat agent.

Port of src/lib/agent/wiki-tools.ts. Surfaces `browse_wiki` (pull a domain's
full index + members), `search_wiki` (LIKE search across all pages), and
`open_wiki_page` (single page by slug, plus backlinks). The agent picks a
domain from the system prompt, then drills in — far tighter retrieval than
dumping every table into context.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from psycopg.rows import dict_row

from ..audit import audit
from ..db import get_conn

log = logging.getLogger(__name__)


TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "browse_wiki",
            "description": (
                "Pull a domain's full wiki index — its description, all member tables/views/skills/docs, "
                "and any concept pages. Call this FIRST when a question fits a domain you saw in the prompt. "
                "Returns enough context to write SQL without inspecting every table."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "domain_slug": {
                        "type": "string",
                        "description": "The domain slug from the catalog index (e.g. 'quality-deviations').",
                    },
                },
                "required": ["domain_slug"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_wiki",
            "description": (
                "Search the wiki for pages matching a query. Use this when no single domain obviously fits "
                "the user's question, OR when you need to find a specific concept that might be in any "
                "domain. Returns up to 10 pages with their slug, title, summary, and the domain they belong to."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "minLength": 2,
                        "description": "Search terms. Matches against page title, summary, and body.",
                    },
                },
                "required": ["query"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "open_wiki_page",
            "description": (
                "Open a specific wiki page by its slug (e.g. 'public.deviations' or 'domain/quality-deviations'). "
                "Returns the full markdown body, its domain, and pages that link to it. Use this when you need "
                "the deep detail of a single source — e.g. to read the columns and common filter patterns "
                "before writing SQL."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "slug": {"type": "string", "description": "Full wiki page slug."},
                },
                "required": ["slug"],
                "additionalProperties": False,
            },
        },
    },
]


async def run_tool(name: str, args: dict[str, Any], *, conversation_id: str) -> str:
    """Dispatch one wiki tool. Returns marshalled JSON string."""
    try:
        if name == "browse_wiki":
            return _json(await browse_wiki(args["domain_slug"], conversation_id=conversation_id))
        if name == "search_wiki":
            return _json(await search_wiki(args["query"], conversation_id=conversation_id))
        if name == "open_wiki_page":
            return _json(await open_wiki_page(args["slug"], conversation_id=conversation_id))
        return _json({"error": f"Unknown wiki tool: {name}"})
    except Exception as e:  # noqa: BLE001
        log.exception("wiki_tools.run_tool failed: %s", name)
        return _json({"error": f"{type(e).__name__}: {e}"})


async def browse_wiki(domain_slug: str, *, conversation_id: str) -> dict[str, Any]:
    await audit("agent", "tool:browse_wiki", domain_slug, {"conversationId": conversation_id})
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                "SELECT id, slug, name, description FROM wiki_domains WHERE slug = %s",
                (domain_slug,),
            )
            dom = await cur.fetchone()
            if not dom:
                return {
                    "error": (
                        f'No domain named "{domain_slug}". Use search_wiki instead if you '
                        "don't know which domain fits."
                    )
                }
            await cur.execute(
                """
                SELECT slug, body_md FROM wiki_pages
                 WHERE domain_id = %s AND page_type = 'index'
                 ORDER BY updated_at DESC LIMIT 1
                """,
                (dom["id"],),
            )
            index_page = await cur.fetchone()
            await cur.execute(
                """
                SELECT slug, title, summary, corpus, page_type
                  FROM wiki_pages
                 WHERE domain_id = %s AND page_type IN ('source','concept')
                 ORDER BY corpus, title
                """,
                (dom["id"],),
            )
            members = await cur.fetchall()
    return {
        "domain": {"slug": dom["slug"], "name": dom["name"], "description": dom["description"]},
        "index_page_body_md": index_page["body_md"] if index_page else None,
        "members": members,
    }


async def search_wiki(query: str, *, conversation_id: str) -> dict[str, Any]:
    await audit(
        "agent",
        "tool:search_wiki",
        None,
        {"conversationId": conversation_id, "query": query[:200]},
    )
    pattern = "%" + query.replace("%", "").replace("_", "") + "%"
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT p.slug, p.title, p.summary, p.page_type, p.corpus,
                       d.name AS domain_name, d.slug AS domain_slug
                  FROM wiki_pages p
                  LEFT JOIN wiki_domains d ON d.id = p.domain_id
                 WHERE p.title ILIKE %s OR p.summary ILIKE %s OR p.body_md ILIKE %s
                 ORDER BY
                   CASE WHEN p.title ILIKE %s THEN 0
                        WHEN p.summary ILIKE %s THEN 1
                        ELSE 2
                   END,
                   p.updated_at DESC
                 LIMIT 10
                """,
                (pattern, pattern, pattern, pattern, pattern),
            )
            rows = await cur.fetchall()
    return {"query": query, "hits": rows}


async def open_wiki_page(slug: str, *, conversation_id: str) -> dict[str, Any]:
    await audit("agent", "tool:open_wiki_page", slug, {"conversationId": conversation_id})
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT p.slug, p.title, p.summary, p.body_md, p.page_type, p.corpus,
                       d.name AS domain_name, d.slug AS domain_slug
                  FROM wiki_pages p
                  LEFT JOIN wiki_domains d ON d.id = p.domain_id
                 WHERE p.slug = %s
                 LIMIT 1
                """,
                (slug,),
            )
            page = await cur.fetchone()
            if not page:
                return {"error": f'No wiki page with slug "{slug}".'}
            await cur.execute(
                """
                SELECT p.slug, p.title
                  FROM wiki_links l
                  JOIN wiki_pages p ON p.id = l.from_page_id
                 WHERE l.to_slug = %s
                 ORDER BY p.title LIMIT 20
                """,
                (slug,),
            )
            backlinks = await cur.fetchall()
    return {"page": page, "backlinks": backlinks}


def _json(value: Any) -> str:
    return json.dumps(value, default=str)
