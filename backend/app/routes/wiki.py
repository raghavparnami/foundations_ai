"""Wiki routes — pages, tree, single-page fetch, log.

Ports:
    src/app/api/wiki/route.ts                 → GET /api/wiki
    src/app/api/wiki/page/route.ts            → GET /api/wiki/page
    src/app/api/wiki/tree/route.ts            → GET /api/wiki/tree
    src/app/api/wiki/[kind]/[slug]/route.ts   → GET /api/wiki/{kind}/{slug}
    src/app/api/wiki/log/route.ts             → GET /api/wiki/log

Mutation routes (upload, discover-domains, code-sources, seed-views) live in
their own module(s) below or come in a later chunk.
"""
from __future__ import annotations

import hashlib
import io
import logging
from typing import Annotated, Any, Literal

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from pydantic import BaseModel

from app.audit import audit
from app.catalog.wiki import get_backlinks, get_wiki_page, list_wiki_pages
from app.db import get_conn

log = logging.getLogger(__name__)
router = APIRouter()

WikiKindParam = Literal["tables", "docs", "code"]


@router.get("")
async def list_wiki(
    kind: Annotated[WikiKindParam | None, Query()] = None,
) -> dict[str, list[dict[str, Any]]]:
    pages = await list_wiki_pages(kind)
    return {
        "pages": [
            {
                "id": int(p["id"]),
                "kind": p["kind"],
                "slug": p["slug"],
                "title": p["title"],
                "summary": p["summary"],
                "status": p["status"],
                "updated_at": p["updated_at"],
            }
            for p in pages
        ]
    }


@router.get("/page")
async def page_by_slug(slug: Annotated[str, Query()]) -> dict[str, Any]:
    """Resolve a wiki page by slug, accepting three forms:

    1. ``domain/<slug>``   — exact slug match (domain landing pages)
    2. ``<kind>/<slug>``   — split: kind ∈ {tables,docs,code}, slug = rest
    3. ``<slug>``           — bare slug; match against any kind

    This lets the frontend link to either ``tables/public.deviations`` or just
    ``public.deviations`` and have it resolve to the right page.
    """
    raw = slug.strip()
    # Decode kind/slug split for the kind table-like prefixes.
    bare_slug = raw
    kind_filter: str | None = None
    if "/" in raw:
        prefix, rest = raw.split("/", 1)
        if prefix in ("tables", "docs", "code"):
            kind_filter = prefix
            bare_slug = rest

    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            # Try 1: exact match (covers ``domain/<slug>`` + bare slugs)
            await cur.execute(
                """
                SELECT p.id, p.kind, p.slug, p.title, p.summary, p.body_md, p.page_type,
                       p.corpus, p.domain_id,
                       d.slug AS domain_slug, d.name AS domain_name,
                       p.status,
                       p.updated_at::text AS updated_at,
                       p.generated_at::text AS generated_at
                  FROM wiki_pages p
                  LEFT JOIN wiki_domains d ON d.id = p.domain_id
                 WHERE p.slug = %s
                """,
                (raw,),
            )
            page = await cur.fetchone()

            # Try 2: kind + slug split (e.g. tables/public.deviations → slug=public.deviations)
            if not page and kind_filter is not None:
                await cur.execute(
                    """
                    SELECT p.id, p.kind, p.slug, p.title, p.summary, p.body_md, p.page_type,
                           p.corpus, p.domain_id,
                           d.slug AS domain_slug, d.name AS domain_name,
                           p.status,
                           p.updated_at::text AS updated_at,
                           p.generated_at::text AS generated_at
                      FROM wiki_pages p
                      LEFT JOIN wiki_domains d ON d.id = p.domain_id
                     WHERE p.kind = %s AND p.slug = %s
                     LIMIT 1
                    """,
                    (kind_filter, bare_slug),
                )
                page = await cur.fetchone()

            # Try 3: kind-prefix mismatch — link said tables/X but the page is
            # actually kind='code' or 'docs'. Match the bare slug across any kind.
            if not page and kind_filter is not None:
                await cur.execute(
                    """
                    SELECT p.id, p.kind, p.slug, p.title, p.summary, p.body_md, p.page_type,
                           p.corpus, p.domain_id,
                           d.slug AS domain_slug, d.name AS domain_name,
                           p.status,
                           p.updated_at::text AS updated_at,
                           p.generated_at::text AS generated_at
                      FROM wiki_pages p
                      LEFT JOIN wiki_domains d ON d.id = p.domain_id
                     WHERE p.slug = %s
                     ORDER BY p.updated_at DESC
                     LIMIT 1
                    """,
                    (bare_slug,),
                )
                page = await cur.fetchone()

            # Try 4: bare slug across any kind (fallback for older link shapes)
            if not page and "/" not in raw:
                await cur.execute(
                    """
                    SELECT p.id, p.kind, p.slug, p.title, p.summary, p.body_md, p.page_type,
                           p.corpus, p.domain_id,
                           d.slug AS domain_slug, d.name AS domain_name,
                           p.status,
                           p.updated_at::text AS updated_at,
                           p.generated_at::text AS generated_at
                      FROM wiki_pages p
                      LEFT JOIN wiki_domains d ON d.id = p.domain_id
                     WHERE p.slug = %s
                     ORDER BY p.updated_at DESC
                     LIMIT 1
                    """,
                    (bare_slug,),
                )
                page = await cur.fetchone()

            if not page:
                raise HTTPException(404, detail="not_found")
            slug = str(page["slug"])  # canonicalise for downstream queries

            short = slug.split("/", 1)[1] if "/" in slug else slug
            await cur.execute(
                """
                SELECT p.slug, p.title, p.summary, p.page_type,
                       d.slug AS domain_slug, d.name AS domain_name
                  FROM wiki_links l
                  JOIN wiki_pages p ON p.id = l.from_page_id
                  LEFT JOIN wiki_domains d ON d.id = p.domain_id
                 WHERE l.to_slug = %s OR l.to_slug = %s
                 ORDER BY p.title
                """,
                (slug, short),
            )
            backlinks = await cur.fetchall()

            siblings: list[dict[str, Any]] = []
            if page["domain_id"] is not None:
                await cur.execute(
                    """
                    SELECT slug, title, page_type
                      FROM wiki_pages
                     WHERE domain_id = %s AND id <> %s
                     ORDER BY page_type, title
                     LIMIT 30
                    """,
                    (page["domain_id"], page["id"]),
                )
                siblings = await cur.fetchall()

    return {"page": page, "backlinks": backlinks, "siblings": siblings}


@router.get("/tree")
async def tree_route() -> dict[str, Any]:
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
            await cur.execute(
                """
                SELECT domain_id, slug, title, summary, page_type, corpus
                  FROM wiki_pages
                 ORDER BY corpus, title
                """
            )
            pages = await cur.fetchall()

    by_domain: dict[int, list[dict[str, Any]]] = {}
    unassigned: list[dict[str, Any]] = []
    for p in pages:
        if p["domain_id"] is None:
            unassigned.append(_strip_domain(p))
        else:
            by_domain.setdefault(int(p["domain_id"]), []).append(p)

    out: list[dict[str, Any]] = []
    for d in domains:
        members = by_domain.get(int(d["id"]), [])
        index_page = next((m for m in members if m["page_type"] == "index"), None)
        non_index = [m for m in members if m["page_type"] != "index"]
        out.append({
            "id": int(d["id"]),
            "slug": d["slug"],
            "name": d["name"],
            "description": d["description"],
            "color": d["color"],
            "index_slug": index_page["slug"] if index_page else None,
            "page_count": len(non_index),
            "pages": [_strip_domain(m) for m in non_index],
        })

    return {"domains": out, "unassigned": unassigned}


def _strip_domain(p: dict[str, Any]) -> dict[str, Any]:
    return {
        "slug": p["slug"],
        "title": p["title"],
        "summary": p["summary"],
        "page_type": p["page_type"],
        "corpus": p["corpus"],
    }


@router.get("/{kind}/{slug:path}")
async def page_by_kind_slug(kind: WikiKindParam, slug: str) -> dict[str, Any]:
    page = await get_wiki_page(kind, slug)
    if not page:
        raise HTTPException(404, detail="not_found")
    backlinks = await get_backlinks(kind, slug)
    return {
        "page": {
            "id": int(page["id"]),
            "kind": page["kind"],
            "slug": page["slug"],
            "title": page["title"],
            "summary": page["summary"],
            "body_md": page["body_md"],
            "source_ref": page["source_ref"],
            "status": page["status"],
            "generated_at": page["generated_at"],
            "updated_at": page["updated_at"],
        },
        "backlinks": [
            {"kind": b["kind"], "slug": b["slug"], "title": b["title"]}
            for b in backlinks
        ],
    }


@router.get("/log")
async def log_route(
    domain: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 30,
) -> dict[str, list[dict[str, Any]]]:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            if domain:
                await cur.execute(
                    """
                    SELECT ts::text, kind, target_kind, target_slug, domain_slug, summary
                      FROM wiki_log WHERE domain_slug = %s
                     ORDER BY ts DESC LIMIT %s
                    """,
                    (domain, limit),
                )
            else:
                await cur.execute(
                    """
                    SELECT ts::text, kind, target_kind, target_slug, domain_slug, summary
                      FROM wiki_log ORDER BY ts DESC LIMIT %s
                    """,
                    (limit,),
                )
            return {"entries": await cur.fetchall()}


# ─── Mutation routes ───────────────────────────────────────────────────────


class CodeSourceBody(BaseModel):
    provider: Literal["gitlab", "github"]
    display_name: str
    project_path: str
    base_url: str | None = None
    token_ref: str | None = None
    default_branch: str = "main"
    include_globs: list[str] | None = None
    exclude_globs: list[str] | None = None


@router.post("/code-sources")
async def add_code_source(body: CodeSourceBody) -> dict[str, Any]:
    """Register a GitLab/GitHub repo. The code-wiki agent picks it up on the
    next tick (or you can hit /api/wiki/code-sources/run to fire it now).
    """
    base_url = body.base_url or (
        "https://gitlab.com" if body.provider == "gitlab" else "https://api.github.com"
    )
    include = body.include_globs or [
        "**/*.md",
        "**/*.ts",
        "**/*.py",
        "**/*.sql",
        "**/*.tsx",
    ]
    exclude = body.exclude_globs or [
        "node_modules/**",
        "dist/**",
        "build/**",
        ".git/**",
    ]
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                INSERT INTO code_sources (provider, display_name, project_path,
                                          base_url, token_ref, default_branch,
                                          include_globs, exclude_globs)
                     VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (provider, project_path) DO UPDATE
                  SET display_name = EXCLUDED.display_name,
                      base_url = EXCLUDED.base_url,
                      token_ref = EXCLUDED.token_ref,
                      default_branch = EXCLUDED.default_branch,
                      include_globs = EXCLUDED.include_globs,
                      exclude_globs = EXCLUDED.exclude_globs
                RETURNING id, provider, display_name, project_path, status
                """,
                (
                    body.provider,
                    body.display_name,
                    body.project_path,
                    base_url,
                    body.token_ref,
                    body.default_branch,
                    Jsonb(include),
                    Jsonb(exclude),
                ),
            )
            row = await cur.fetchone()
    assert row is not None
    await audit("user", "code_source:register", body.display_name, {"provider": body.provider})
    return {"source": row}


@router.post("/upload")
async def upload_document(
    file: Annotated[UploadFile, File(...)],
    display_name: Annotated[str | None, Form()] = None,
) -> dict[str, Any]:
    """Upload a PDF / DOCX / Markdown / plain-text file. We extract its text,
    insert a row in `documents` with status='pending', and the docs-wiki
    agent picks it up on the next tick.
    """
    raw = await file.read()
    if not raw:
        raise HTTPException(400, detail="empty file")
    filename = file.filename or "document"
    name = (display_name or filename).strip()
    content_hash = hashlib.md5(raw).hexdigest()
    mime = (file.content_type or _guess_mime(filename)).strip()
    body_text = _extract_text(filename, raw, mime)
    if not body_text.strip():
        raise HTTPException(
            400,
            detail=f"could not extract text from {filename!r}; supported: PDF, DOCX, MD, TXT",
        )

    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                INSERT INTO documents (origin, uri, display_name, mime, size_bytes,
                                       content_hash, body_text, status)
                     VALUES ('upload', %s, %s, %s, %s, %s, %s, 'pending')
                ON CONFLICT (origin, content_hash) DO UPDATE
                  SET display_name = EXCLUDED.display_name,
                      mime = EXCLUDED.mime,
                      status = CASE
                        WHEN documents.status = 'failed' THEN 'pending'
                        ELSE documents.status
                      END
                RETURNING id, display_name, mime, size_bytes::int, status, uploaded_at::text
                """,
                (filename, name, mime, len(raw), content_hash, body_text),
            )
            row = await cur.fetchone()
    assert row is not None
    await audit("user", "document:upload", name, {"bytes": len(raw), "mime": mime})
    return {"document": row, "extracted_chars": len(body_text)}


_MIME_BY_EXT = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "md": "text/markdown",
    "txt": "text/plain",
    "html": "text/html",
    "rtf": "application/rtf",
}


def _guess_mime(filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return _MIME_BY_EXT.get(ext, "application/octet-stream")


def _extract_text(filename: str, raw: bytes, mime: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    try:
        if ext == "pdf" or mime == "application/pdf":
            return _extract_pdf(raw)
        if ext == "docx" or mime.endswith("wordprocessingml.document"):
            return _extract_docx(raw)
        # MD / TXT / HTML / unknown → decode as utf-8 with fallback
        return raw.decode("utf-8", errors="replace")
    except Exception as e:  # noqa: BLE001
        log.warning("upload.extract_failed file=%s err=%s", filename, e)
        return ""


def _extract_pdf(raw: bytes) -> str:
    """Extract text + tables from a PDF.

    Uses pdfplumber so structured tables come through as Markdown pipe tables,
    not line-wrapped pseudo-prose. Images are noted (count + per-page marker)
    but not OCR'd here — a vision-LLM pass can be wired separately.
    """
    import pdfplumber  # type: ignore[import-not-found]

    parts: list[str] = []
    image_count = 0
    with pdfplumber.open(io.BytesIO(raw)) as pdf:
        for i, page in enumerate(pdf.pages, start=1):
            page_parts: list[str] = [f"## Page {i}"]
            try:
                text = (page.extract_text() or "").strip()
            except Exception:  # noqa: BLE001
                text = ""
            if text:
                page_parts.append(text)

            try:
                tables = page.extract_tables() or []
            except Exception:  # noqa: BLE001
                tables = []
            for t_idx, table in enumerate(tables, start=1):
                md = _table_to_markdown(table)
                if md:
                    page_parts.append(f"\n**Table {i}.{t_idx}**")
                    page_parts.append(md)

            try:
                imgs = page.images or []
            except Exception:  # noqa: BLE001
                imgs = []
            if imgs:
                image_count += len(imgs)
                page_parts.append(
                    f"\n_({len(imgs)} image{'' if len(imgs) == 1 else 's'} on page {i} — figure not transcribed.)_"
                )
            parts.append("\n".join(page_parts))

    if image_count:
        parts.append(
            f"\n---\n_Document contains {image_count} image{'' if image_count == 1 else 's'} "
            "across all pages — figures noted inline, not OCR'd."
        )
    return "\n\n".join(parts)


def _table_to_markdown(table: list[list[str | None]]) -> str:
    rows: list[list[str]] = [
        ["" if cell is None else " ".join(str(cell).split()) for cell in row]
        for row in table
        if any(cell is not None and str(cell).strip() for cell in row)
    ]
    if not rows:
        return ""
    cols = max(len(r) for r in rows)
    rows = [r + [""] * (cols - len(r)) for r in rows]
    header = "| " + " | ".join(rows[0]) + " |"
    sep = "| " + " | ".join(["---"] * cols) + " |"
    body = "\n".join("| " + " | ".join(r) + " |" for r in rows[1:])
    return "\n".join([header, sep, body]) if body else "\n".join([header, sep])


def _extract_docx(raw: bytes) -> str:
    from docx import Document  # type: ignore[import-not-found]
    doc = Document(io.BytesIO(raw))
    return "\n".join(p.text for p in doc.paragraphs)
