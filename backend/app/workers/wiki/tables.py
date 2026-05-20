"""Tables-wiki agent.

Reads the catalog's tables/views/skills and writes interlinked concept pages
into wiki_pages with kind='tables'. Per-table pages plus a clustered index
page; hash-gated end-to-end via ``upsert_wiki_page``.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any

from psycopg.rows import dict_row

from ...catalog.wiki import upsert_wiki_page
from ...db import get_conn

log = logging.getLogger(__name__)

ACTOR = "wiki-agent:tables"


@dataclass(slots=True)
class TableInfo:
    table_id: int
    schema_name: str
    table_name: str
    status: str
    row_count: int | None
    is_view: bool
    doc_md: str | None
    fk_targets: list[str] = field(default_factory=list)


@dataclass(slots=True)
class ViewInfo:
    name: str
    description: str | None
    sql: str


@dataclass(slots=True)
class SkillInfo:
    slug: str
    name: str
    triggers: list[str]
    description: str


async def run_tables_wiki_agent() -> dict[str, int]:
    tables = await _load_tables()
    views = await _load_views()
    skills = await _load_skills()

    table_slug_set: set[str] = {_table_slug(t.schema_name, t.table_name) for t in tables}

    generated = 0

    # ── Per-table / per-view pages ───────────────────────────────────────────
    for t in tables:
        slug = _table_slug(t.schema_name, t.table_name)
        title = (
            f"{t.schema_name}.{t.table_name}  (view)"
            if t.is_view
            else f"{t.schema_name}.{t.table_name}"
        )
        body = _render_table_page(t, table_slug_set, views, skills)
        summary = (
            f"Saved view · {t.row_count or 0} rows"
            if t.is_view
            else f"Table · {t.row_count or 0} rows"
        )
        r = await upsert_wiki_page(
            ACTOR,
            kind="tables",
            slug=slug,
            title=title,
            summary=summary,
            body_md=body,
            source_ref={
                "table_id": t.table_id,
                "schema": t.schema_name,
                "name": t.table_name,
                "is_view": t.is_view,
            },
        )
        if r["action"] != "skipped":
            generated += 1

    # ── Index page ──────────────────────────────────────────────────────────
    index_body = _render_index_page(tables, views, skills)
    real_tables = sum(1 for t in tables if not t.is_view)
    saved_views = sum(1 for t in tables if t.is_view)
    ix = await upsert_wiki_page(
        ACTOR,
        kind="tables",
        slug="_index",
        title="Tables overview",
        summary=f"{real_tables} tables · {saved_views} saved views",
        body_md=index_body,
        source_ref={
            "tables": len(tables),
            "views": len(views),
            "skills": len(skills),
        },
    )
    if ix["action"] != "skipped":
        generated += 1

    return {"generated": generated}


# ── Render helpers ──────────────────────────────────────────────────────────

def _render_table_page(
    table: TableInfo,
    table_slug_set: set[str],
    views: list[ViewInfo],
    skills: list[SkillInfo],
) -> str:
    parts: list[str] = []
    parts.append(f"# {table.schema_name}.{table.table_name}")
    parts.append("")

    if table.doc_md:
        stripped = re.sub(r"^#\s+[^\n]+\n+", "", table.doc_md)
        parts.append(stripped)
        parts.append("")
    else:
        parts.append(
            "*The catalog hasn't produced a structural+semantic doc yet — "
            "re-tick the scheduler.*"
        )
        parts.append("")

    # ── See also (FK neighbours) ────────────────────────────────────────────
    fk_neighbours: list[str] = []
    for f in table.fk_targets:
        m = re.match(r"^([^.]+)\.([^.]+)", f)
        if not m:
            continue
        slug = _table_slug(m.group(1), m.group(2))
        if slug in table_slug_set:
            fk_neighbours.append(slug)

    if fk_neighbours:
        parts.append("## See also")
        parts.append("")
        for s in fk_neighbours:
            parts.append(f"- [[tables/{s}]]")
        parts.append("")

    # ── Used in views ───────────────────────────────────────────────────────
    name_re = re.compile(rf"\b{re.escape(table.table_name)}\b", re.IGNORECASE)
    used_in_views = [v for v in views if name_re.search(v.sql)]
    if used_in_views:
        parts.append("## Used in views")
        parts.append("")
        for v in used_in_views:
            vslug = _table_slug("loom_views", v.name)
            linkable = vslug in table_slug_set
            target = f"[[tables/{vslug}]]" if linkable else f"`loom_views.{v.name}`"
            tail = f" — {v.description}" if v.description else ""
            parts.append(f"- {target}{tail}")
        parts.append("")

    # ── Skills that mention this table ──────────────────────────────────────
    related_skills: list[SkillInfo] = []
    for sk in skills:
        haystack = sk.description + " " + " ".join(sk.triggers)
        if name_re.search(haystack):
            related_skills.append(sk)
    if related_skills:
        parts.append("## Used by skills")
        parts.append("")
        for sk in related_skills:
            parts.append(f"- **{sk.name}** — {sk.description}")
        parts.append("")

    return "\n".join(parts)


def _render_index_page(
    tables: list[TableInfo], views: list[ViewInfo], skills: list[SkillInfo]
) -> str:
    parts: list[str] = []
    real_tables = sum(1 for t in tables if not t.is_view)
    saved_views = sum(1 for t in tables if t.is_view)

    parts.append("# Tables overview")
    parts.append("")
    parts.append(
        f"Loom is indexing **{real_tables} tables** and "
        f"**{saved_views} saved views**. "
        "Click any link to drill into the page Loom generated for that object."
    )
    parts.append("")

    clusters = _cluster_by_fk(tables)
    for i, group in enumerate(clusters):
        parts.append(f"## Cluster {i + 1}: {_describe_cluster(group)}")
        parts.append("")
        for t in group:
            slug = _table_slug(t.schema_name, t.table_name)
            meta = "view" if t.is_view else f"{t.row_count or 0} rows"
            parts.append(f"- [[tables/{slug}]] — {meta}")
        parts.append("")

    if views:
        parts.append("## Saved views")
        parts.append("")
        for v in views:
            vslug = _table_slug("loom_views", v.name)
            tail = f" — {v.description}" if v.description else ""
            parts.append(f"- [[tables/{vslug}]]{tail}")
        parts.append("")

    if skills:
        parts.append("## Skills tying things together")
        parts.append("")
        for s in skills:
            parts.append(f"- **{s.name}** — {s.description}")
        parts.append("")

    return "\n".join(parts)


# ── Data loaders ────────────────────────────────────────────────────────────

async def _load_tables() -> list[TableInfo]:
    sql = """
        SELECT t.id AS table_id,
               t.schema_name,
               t.table_name,
               t.status,
               t.row_count::text AS row_count,
               (t.schema_name = 'loom_views') AS is_view,
               d.markdown AS doc_md,
               COALESCE(
                 (SELECT array_agg(c.fk_target ORDER BY c.ordinal)
                    FROM columns c
                   WHERE c.table_id = t.id AND c.fk_target IS NOT NULL),
                 ARRAY[]::text[]
               ) AS fk_targets
          FROM tables t
          LEFT JOIN docs d ON d.table_id = t.id
         ORDER BY t.schema_name, t.table_name
    """
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(sql)
            rows = await cur.fetchall()
    out: list[TableInfo] = []
    for row in rows:
        rc_raw = row["row_count"]
        rc: int | None = int(rc_raw) if rc_raw is not None else None
        out.append(
            TableInfo(
                table_id=int(row["table_id"]),
                schema_name=row["schema_name"],
                table_name=row["table_name"],
                status=row["status"],
                row_count=rc,
                is_view=bool(row["is_view"]),
                doc_md=row["doc_md"],
                fk_targets=list(row["fk_targets"] or []),
            )
        )
    return out


async def _load_views() -> list[ViewInfo]:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                "SELECT name, description, sql FROM proposals "
                "WHERE kind = 'view' AND status = 'applied'"
            )
            rows = await cur.fetchall()
    return [
        ViewInfo(name=r["name"], description=r["description"], sql=r["sql"]) for r in rows
    ]


async def _load_skills() -> list[SkillInfo]:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                "SELECT slug, name, triggers, description FROM skills WHERE enabled = TRUE"
            )
            rows = await cur.fetchall()
    out: list[SkillInfo] = []
    for r in rows:
        triggers_raw: Any = r["triggers"]
        triggers: list[str] = list(triggers_raw) if isinstance(triggers_raw, list) else []
        out.append(
            SkillInfo(
                slug=r["slug"],
                name=r["name"],
                triggers=triggers,
                description=r["description"],
            )
        )
    return out


# ── Helpers ────────────────────────────────────────────────────────────────

_SLUG_SAFE = re.compile(r"[^a-z0-9._-]")


def _table_slug(schema: str, name: str) -> str:
    return _SLUG_SAFE.sub("_", f"{schema}.{name}".lower())


def _cluster_by_fk(tables: list[TableInfo]) -> list[list[TableInfo]]:
    """Connected-components clustering over the FK graph."""
    idx: dict[str, int] = {}
    for i, t in enumerate(tables):
        idx[f"{t.schema_name}.{t.table_name}"] = i

    parent = list(range(len(tables)))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for i, t in enumerate(tables):
        for fk in t.fk_targets:
            m = re.match(r"^([^.]+)\.([^.]+)", fk)
            if not m:
                continue
            target_key = f"{m.group(1)}.{m.group(2)}"
            j = idx.get(target_key)
            if j is not None:
                union(i, j)

    buckets: dict[int, list[TableInfo]] = {}
    for i, t in enumerate(tables):
        r = find(i)
        buckets.setdefault(r, []).append(t)

    return sorted(buckets.values(), key=lambda g: -len(g))


def _describe_cluster(group: list[TableInfo]) -> str:
    sorted_g = sorted(group, key=lambda t: -len(t.fk_targets))
    lead = sorted_g[0].table_name
    n = len(group) - 1
    suffix = "" if len(group) == 2 else "s"
    return f"{lead} & {n} related table{suffix}"
