"""Domain discovery — clusters source pages into 3–7 named domains.

Port of src/lib/worker/wiki/domains.ts. Cross-corpus clustering: a domain
might span the `deviations` table, the `deviation-rate` skill, an uploaded
QA runbook, and a quality-check code module. Hash-gated on the input
signal set so 99% of ticks are no-ops.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
from typing import Any

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field, ValidationError

from ...audit import audit
from ...db import get_conn
from ...llm import async_client, chat_model_id

log = logging.getLogger(__name__)

ACTOR = "wiki-agent:domains"

SYSTEM_PROMPT = """You are an information architect organizing a knowledge
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

Return JSON matching this schema:
{
  "domains": [
    {
      "slug": "<lowercase-kebab>",
      "name": "<Title Case 2-4 words>",
      "description": "<one sentence, ≤280 chars>",
      "color": "<#rrggbb>",
      "member_slugs": ["...exact input slugs..."]
    }
  ]
}
2 to 8 domains. No prose."""


_SLUG_RE = re.compile(r"^[a-z][a-z0-9-]+$")
_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


class _Domain(BaseModel):
    slug: str = Field(min_length=2, max_length=40)
    name: str = Field(min_length=2, max_length=80)
    description: str = Field(min_length=10, max_length=280)
    color: str | None = None
    member_slugs: list[str] = Field(min_length=1, max_length=60)


class _DomainsPayload(BaseModel):
    domains: list[_Domain] = Field(min_length=2, max_length=8)


async def discover_domains() -> dict[str, Any]:
    signals = await _collect_signals()
    if not signals:
        return {"changed": False, "domains": []}

    sig_keys = sorted(f"{s['kind']}|{s['slug']}" for s in signals)
    signature = hashlib.md5("\n".join(sig_keys).encode("utf-8")).hexdigest()

    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT details->>'signature' AS value
                  FROM audit_log
                 WHERE actor = %s AND action = 'domains:discover'
                 ORDER BY ts DESC LIMIT 1
                """,
                (ACTOR,),
            )
            row = await cur.fetchone()
    if row and row[0] == signature:
        return {"changed": False, "domains": []}

    # LLM call with structured output.
    client = async_client()
    resp = await client.chat.completions.create(
        model=chat_model_id(),
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": _render_prompt(signals)},
        ],
        response_format={"type": "json_object"},
        temperature=0.2,
    )
    raw = (resp.choices[0].message.content or "{}") if resp.choices else "{}"
    try:
        payload = _DomainsPayload.model_validate_json(raw)
    except (ValidationError, json.JSONDecodeError) as e:
        log.warning("domains.parse_failed err=%s body=%s", e, raw[:300])
        return {"changed": False, "domains": []}

    # Validate slugs/colors; drop members not in signals.
    valid_slugs = {s["slug"] for s in signals}
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for i, d in enumerate(payload.domains):
        if not _SLUG_RE.match(d.slug) or d.slug in seen:
            continue
        if d.color and not _HEX_RE.match(d.color):
            d.color = None
        seen.add(d.slug)
        async with get_conn() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    INSERT INTO wiki_domains (slug, name, description, color, sort_order, updated_at)
                         VALUES (%s, %s, %s, %s, %s, NOW())
                    ON CONFLICT (slug) DO UPDATE
                      SET name = EXCLUDED.name,
                          description = EXCLUDED.description,
                          color = EXCLUDED.color,
                          sort_order = EXCLUDED.sort_order,
                          updated_at = NOW()
                    """,
                    (d.slug, d.name, d.description, d.color, i * 10),
                )
        members = [m for m in d.member_slugs if m in valid_slugs or _strip_prefix(m) in valid_slugs]
        attached = await _attach_members(d.slug, members)
        out.append({"slug": d.slug, "name": d.name, "members": attached})

    # Drop old domains.
    if seen:
        async with get_conn() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "DELETE FROM wiki_domains WHERE slug <> ALL(%s::text[])",
                    (list(seen),),
                )

    await audit(ACTOR, "domains:discover", None,
                {"signature": signature, "domains": len(out), "signals": len(signals)})
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO wiki_log (kind, summary, details)
                     VALUES ('regen', %s, %s)
                """,
                (
                    f"discovered {len(out)} domain{'' if len(out) == 1 else 's'} from {len(signals)} signals",
                    Jsonb({"domains": out}),
                ),
            )
    return {"changed": True, "domains": out}


async def _collect_signals() -> list[dict[str, str]]:
    """Gather one signal per wiki source page so the LLM's returned
    member_slugs already match wiki_pages.slug — no resolution dance.
    """
    out: list[dict[str, str]] = []
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            # Tables + views — pulled from wiki_pages so slugs match exactly.
            await cur.execute(
                """
                SELECT slug, title, summary, corpus
                  FROM wiki_pages
                 WHERE kind = 'tables'
                   AND page_type IN ('source', 'concept')
                   AND slug NOT LIKE 'domain/%%'
                   AND slug <> '_index'
                 ORDER BY slug
                """
            )
            for p in await cur.fetchall():
                out.append({
                    "kind": "table" if p.get("corpus") != "views" else "view",
                    "slug": p["slug"],
                    "label": p["title"] or p["slug"],
                    "description": (p.get("summary") or "Source table or saved view")[:200],
                })
            # Documents wiki pages
            await cur.execute(
                """
                SELECT slug, title, summary
                  FROM wiki_pages
                 WHERE kind = 'docs' AND page_type IN ('source', 'concept')
                 ORDER BY slug
                """
            )
            for p in await cur.fetchall():
                out.append({
                    "kind": "doc",
                    "slug": p["slug"],
                    "label": p["title"] or p["slug"],
                    "description": (p.get("summary") or "Uploaded document")[:200],
                })
            # Code modules
            await cur.execute(
                """
                SELECT slug, title, summary
                  FROM wiki_pages
                 WHERE kind = 'code' AND page_type IN ('source', 'concept')
                 ORDER BY slug
                """
            )
            for p in await cur.fetchall():
                out.append({
                    "kind": "code",
                    "slug": p["slug"],
                    "label": p["title"] or p["slug"],
                    "description": (p.get("summary") or "Code module")[:200],
                })
            # Skills (kept separate — no wiki_pages mirror yet)
            await cur.execute(
                "SELECT slug, name, description FROM skills WHERE enabled = TRUE ORDER BY slug"
            )
            for s in await cur.fetchall():
                out.append({
                    "kind": "skill",
                    "slug": f"skill:{s['slug']}",
                    "label": s["name"],
                    "description": s["description"],
                })
    return out


def _render_prompt(signals: list[dict[str, str]]) -> str:
    grouped: dict[str, list[dict[str, str]]] = {}
    for s in signals:
        grouped.setdefault(s["kind"], []).append(s)
    sections: list[str] = []
    for kind, items in grouped.items():
        sections.append(
            f"## {kind.upper()}S ({len(items)})\n"
            + "\n".join(f"- {i['slug']} — {i['label']}: {i['description']}" for i in items)
        )
    return "Cluster the following catalog members into 3-7 domains.\n\n" + "\n\n".join(sections)


def _strip_prefix(slug: str) -> str:
    return re.sub(r"^(skill|doc|code|table):", "", slug, flags=re.IGNORECASE)


async def _attach_members(domain_slug: str, member_slugs: list[str]) -> int:
    """Member slugs are real ``wiki_pages.slug`` values; do an exact-match
    bulk UPDATE. Falls back to a couple of legacy patterns so skill: + bare
    slugs from older runs still resolve.
    """
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute("SELECT id FROM wiki_domains WHERE slug = %s", (domain_slug,))
            row = await cur.fetchone()
    if not row:
        return 0
    domain_id = int(row[0])

    # Direct exact-match path: works for every signal coming from wiki_pages.
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE wiki_pages SET domain_id = %s WHERE slug = ANY(%s::text[]) AND domain_id IS DISTINCT FROM %s",
                (domain_id, member_slugs, domain_id),
            )
            count = cur.rowcount or 0

    # Legacy fallback: handle skill: / doc: / code: / table: prefixed slugs.
    for m in member_slugs:
        trimmed = _strip_prefix(m)
        if trimmed == m:
            continue
        patterns = [trimmed, f"tables/{trimmed}", re.sub(r"[^a-z0-9]", "-", trimmed.lower())]
        for p in patterns:
            async with get_conn() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(
                        "UPDATE wiki_pages SET domain_id = %s WHERE slug = %s OR slug LIKE %s",
                        (domain_id, p, f"{p}%"),
                    )
                    count += cur.rowcount or 0
            if count:
                break
    return count
