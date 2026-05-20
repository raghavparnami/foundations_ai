"""Domain index builder — synthesizes the one-per-domain landing page.

Port of src/lib/worker/wiki/domain-index.ts. Template-only (no LLM call).
Reads each wiki_domains row + its members + recent wiki_log entries and
upserts a wiki_pages row with slug ``domain/<slug>`` and page_type='index'.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from psycopg.rows import dict_row

from ...catalog.wiki import upsert_wiki_page
from ...db import get_conn

log = logging.getLogger(__name__)

ACTOR = "wiki-agent:domain-index"


async def run_domain_index_builder() -> dict[str, int]:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT id, slug, name, description, color
                  FROM wiki_domains
                 ORDER BY sort_order, name
                """
            )
            domains = await cur.fetchall()

    generated = 0
    for d in domains:
        body = await _render(d)
        slug = f"domain/{d['slug']}"
        r = await upsert_wiki_page(
            ACTOR,
            kind="tables",  # legacy column; page_type below is the real axis
            slug=slug,
            title=d["name"],
            summary=d["description"],
            body_md=body,
            source_ref={"domain_id": int(d["id"])},
        )
        async with get_conn() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    UPDATE wiki_pages
                       SET page_type = 'index', domain_id = %s, corpus = 'mixed'
                     WHERE id = %s
                    """,
                    (int(d["id"]), int(r["id"])),
                )
        if r.get("action") != "skipped":
            generated += 1
    return {"generated": generated}


async def _render(d: dict[str, Any]) -> str:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT id, kind, slug, title, summary, corpus
                  FROM wiki_pages
                 WHERE domain_id = %s AND page_type IN ('source','concept')
                 ORDER BY corpus, title
                """,
                (int(d["id"]),),
            )
            members = await cur.fetchall()
            await cur.execute(
                """
                SELECT ts::text AS ts, kind, summary, target_slug
                  FROM wiki_log
                 WHERE domain_slug = %s
                 ORDER BY ts DESC
                 LIMIT 8
                """,
                (d["slug"],),
            )
            log_rows = await cur.fetchall()

    grouped: dict[str, list[dict[str, Any]]] = {}
    for m in members:
        corpus = m.get("corpus") or _guess_corpus(m.get("kind") or "", m["slug"])
        grouped.setdefault(corpus, []).append(m)

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    parts: list[str] = [f"# {d['name']}", ""]
    if d.get("description"):
        parts.append(f"> {d['description']}")
    parts.append("")
    parts.append(f"**{len(members)} pages in this domain** · last refreshed {today}")
    parts.append("")

    if not members:
        parts.append("_No pages assigned to this domain yet. The next ingestion cycle will populate it._")
    else:
        for corpus, items in grouped.items():
            parts.append(f"## {_corpus_heading(corpus)} ({len(items)})")
            parts.append("")
            for m in items:
                sub = f" — {m['summary']}" if m.get("summary") else ""
                parts.append(f"- [[{m['slug']}]]{sub}")
            parts.append("")

    if log_rows:
        parts.append("## Recent activity")
        parts.append("")
        for r in log_rows:
            ts = (r["ts"] or "")[:16].replace("T", " ")
            parts.append(f"- `{ts}` · **{r['kind']}** · {r['summary']}")
        parts.append("")

    return "\n".join(parts)


def _guess_corpus(_kind: str, slug: str) -> str:
    if slug.startswith("tables/loom_views."):
        return "views"
    if slug.startswith("tables/"):
        return "tables"
    if slug.startswith("docs/"):
        return "documents"
    if slug.startswith("code/"):
        return "code"
    if "skill" in slug:
        return "skills"
    return "other"


def _corpus_heading(corpus: str) -> str:
    return {
        "tables": "Tables", "views": "Saved views", "documents": "Documents",
        "code": "Code", "skills": "Skills", "mixed": "Mixed",
    }.get(corpus, corpus[:1].upper() + corpus[1:])
