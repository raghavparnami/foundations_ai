"""Code-wiki agent — registered repos → per-module wiki pages.

Port of src/lib/worker/wiki/code.ts. For each `code_sources` row:
  1. List files in default branch via GitLab REST (httpx, no python-gitlab dep)
  2. Skip files whose blob_sha matches; pull bodies for changed files (1MB cap)
  3. Cluster files by top-level directory ("module")
  4. LLM-write one wiki_pages row per module with a strict template
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

import httpx
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from ...audit import audit
from ...catalog.wiki import upsert_wiki_page
from ...db import get_conn
from ...llm import async_client, chat_model_id
from ..rules import with_rules

log = logging.getLogger(__name__)

ACTOR = "wiki-agent:code"
_FILE_SIZE_CAP = 1_000_000

SYSTEM_PROMPT = """You are Loom's code-corpus summarizer. Given a small set of
source files from a single module/directory of a repository, write a wiki
page in this exact structure:

  ## What this module does
  One paragraph: the role this module plays in the repo.

  ## Public surface
  Bullet list of the most important exports / entry points / scripts the
  reader would invoke. Use `code` formatting for symbols.

  ## Dependencies & data
  - external libs of note
  - if the module references Loom catalog tables by name, list them as
    [[tables/<slug>]] cross-refs

  ## When to reference
  2 or 3 bullets describing when an analyst should pull this module into a
  conversation.

Write nothing outside these sections. No preamble."""


async def run_code_wiki_agent() -> dict[str, int]:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT id, provider, display_name, project_path, base_url, token_ref,
                       default_branch, include_globs, exclude_globs
                  FROM code_sources
                 WHERE status IN ('pending','ready','failed')
                   AND (last_synced_at IS NULL OR last_synced_at < NOW() - interval '1 hour')
                """
            )
            sources = await cur.fetchall()

    generated = 0
    for src in sources:
        try:
            generated += await _sync_one_source(src)
        except Exception as e:  # noqa: BLE001
            async with get_conn() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(
                        "UPDATE code_sources SET status = 'failed' WHERE id = %s",
                        (src["id"],),
                    )
            await audit(ACTOR, "wiki:code_sync_failed", src["display_name"], {"err": str(e)})
    return {"generated": generated}


async def _sync_one_source(src: dict[str, Any]) -> int:
    import os
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE code_sources SET status = 'syncing' WHERE id = %s", (src["id"],)
            )

    provider = src.get("provider") or "gitlab"
    token = os.environ.get(src["token_ref"]) if src["token_ref"] else None
    default_base = (
        "https://api.github.com"
        if provider == "github"
        else "https://gitlab.com"
    )
    base = (src["base_url"] or default_base).rstrip("/")
    project = src["project_path"]
    branch = src["default_branch"] or "main"
    include = src["include_globs"] or ["**/*.md"]
    exclude = src["exclude_globs"] or []

    async with httpx.AsyncClient(timeout=30) as client:
        files = await _list_tree(client, base, token, project, branch, provider)
        candidates = [f for f in files if _matches_globs(f["path"], include, exclude)]

        # Diff against catalog blob_shas.
        async with get_conn() as conn:
            async with conn.cursor(row_factory=dict_row) as cur:
                await cur.execute(
                    "SELECT path, blob_sha FROM code_files WHERE code_source_id = %s",
                    (src["id"],),
                )
                rows = await cur.fetchall()
        existing = {r["path"]: r["blob_sha"] for r in rows}

        changed = 0
        for f in candidates:
            if existing.get(f["path"]) == f["id"]:
                continue
            try:
                body = await _get_raw(client, base, token, project, branch, f["path"], provider)
            except httpx.HTTPError as e:
                await audit(ACTOR, "wiki:code_file_failed", f["path"], {"err": str(e)})
                continue
            if len(body) > _FILE_SIZE_CAP:
                continue
            lang = _language_of(f["path"])
            async with get_conn() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(
                        """
                        INSERT INTO code_files (code_source_id, path, blob_sha, language, size_bytes, body)
                             VALUES (%s, %s, %s, %s, %s, %s)
                        ON CONFLICT (code_source_id, path) DO UPDATE
                          SET blob_sha = EXCLUDED.blob_sha,
                              language = EXCLUDED.language,
                              size_bytes = EXCLUDED.size_bytes,
                              body = EXCLUDED.body,
                              indexed_at = NOW()
                        """,
                        (src["id"], f["path"], f["id"], lang, len(body), body),
                    )
            changed += 1

    # Drop files that disappeared.
    repo_paths = {f["path"] for f in candidates}
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            if repo_paths:
                await cur.execute(
                    "DELETE FROM code_files WHERE code_source_id = %s AND path <> ALL(%s)",
                    (src["id"], list(repo_paths)),
                )

    # Cluster by top-level dir, generate one wiki page per module.
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                "SELECT path, body, language FROM code_files WHERE code_source_id = %s",
                (src["id"],),
            )
            all_files = await cur.fetchall()
    by_module: dict[str, list[dict[str, Any]]] = {}
    for f in all_files:
        mod = f["path"].split("/", 1)[0] or "_root"
        by_module.setdefault(mod, []).append(f)

    pages_generated = 0
    client_llm = async_client()
    for module, group in by_module.items():
        sample = _compose_module_sample(group)
        resp = await client_llm.chat.completions.create(
            model=chat_model_id(),
            messages=[
                {"role": "system", "content": with_rules(SYSTEM_PROMPT, "wiki")},
                {"role": "user",
                 "content": f"# Repo: {src['display_name']} · Module: {module}\n\n{sample}"},
            ],
            temperature=0.2,
        )
        text = (resp.choices[0].message.content or "").strip() if resp.choices else ""
        slug = _slugify(f"{src['display_name']}-{module}")
        r = await upsert_wiki_page(
            ACTOR,
            kind="code",
            slug=slug,
            title=f"{src['display_name']} / {module}",
            summary=_first_line_of(text) or f"Module: {module}",
            body_md=text,
            source_ref={
                "code_source_id": int(src["id"]),
                "module": module,
                "files": [f["path"] for f in group],
            },
        )
        if r.get("action") != "skipped":
            pages_generated += 1

    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE code_sources SET status = 'ready', last_synced_at = NOW() WHERE id = %s",
                (src["id"],),
            )
    await audit(
        ACTOR, "wiki:code_sync_ok", src["display_name"],
        {"files_changed": changed, "modules": len(by_module)},
    )
    return pages_generated


# ─── Provider-aware REST helpers (gitlab + github) ────────────────────────


async def _list_tree(
    client: httpx.AsyncClient,
    base: str,
    token: str | None,
    project: str,
    branch: str,
    provider: str,
) -> list[dict[str, Any]]:
    if provider == "github":
        return await _list_tree_github(client, token, project, branch)
    return await _list_tree_gitlab(client, base, token, project, branch)


async def _get_raw(
    client: httpx.AsyncClient,
    base: str,
    token: str | None,
    project: str,
    branch: str,
    path: str,
    provider: str,
) -> str:
    if provider == "github":
        return await _get_raw_github(client, token, project, branch, path)
    return await _get_raw_gitlab(client, base, token, project, branch, path)


async def _list_tree_gitlab(
    client: httpx.AsyncClient, base: str, token: str | None, project: str, branch: str
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    page = 1
    while True:
        params = {"ref": branch, "recursive": "true", "per_page": "100", "page": str(page)}
        headers = {"PRIVATE-TOKEN": token} if token else {}
        url = f"{base}/api/v4/projects/{_url(project)}/repository/tree"
        res = await client.get(url, params=params, headers=headers)
        res.raise_for_status()
        batch = res.json()
        if not batch:
            break
        out.extend([n for n in batch if n.get("type") == "blob"])
        if len(batch) < 100:
            break
        page += 1
    return out


async def _get_raw_gitlab(
    client: httpx.AsyncClient, base: str, token: str | None,
    project: str, branch: str, path: str,
) -> str:
    headers = {"PRIVATE-TOKEN": token} if token else {}
    url = f"{base}/api/v4/projects/{_url(project)}/repository/files/{_url(path)}/raw"
    res = await client.get(url, params={"ref": branch}, headers=headers)
    res.raise_for_status()
    return res.text


def _github_headers(token: str | None) -> dict[str, str]:
    h = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


async def _list_tree_github(
    client: httpx.AsyncClient, token: str | None, project: str, branch: str
) -> list[dict[str, Any]]:
    """project is `owner/repo`. Resolve branch → tree sha → recursive listing."""
    headers = _github_headers(token)
    # Resolve branch tip sha
    br = await client.get(
        f"https://api.github.com/repos/{project}/branches/{branch}",
        headers=headers,
    )
    br.raise_for_status()
    tree_sha = br.json()["commit"]["commit"]["tree"]["sha"]
    tr = await client.get(
        f"https://api.github.com/repos/{project}/git/trees/{tree_sha}",
        params={"recursive": "1"},
        headers=headers,
    )
    tr.raise_for_status()
    payload = tr.json()
    # GitHub returns {tree: [{path, mode, type, sha, size}]}. Normalise shape
    # to match the gitlab one: {path, id (== sha), type, name}.
    return [
        {
            "path": n["path"],
            "id": n["sha"],
            "type": "blob" if n.get("type") == "blob" else n.get("type"),
            "name": n["path"].rsplit("/", 1)[-1],
        }
        for n in payload.get("tree", [])
        if n.get("type") == "blob"
    ]


async def _get_raw_github(
    client: httpx.AsyncClient, token: str | None,
    project: str, branch: str, path: str,
) -> str:
    """Use raw.githubusercontent for public; authenticated for private."""
    if token:
        # Authenticated API contents endpoint (returns base64). Decode here.
        import base64
        res = await client.get(
            f"https://api.github.com/repos/{project}/contents/{path}",
            params={"ref": branch},
            headers=_github_headers(token),
        )
        res.raise_for_status()
        content_b64 = res.json().get("content") or ""
        return base64.b64decode(content_b64).decode("utf-8", errors="replace")
    # Public: skip the API and pull raw.
    res = await client.get(
        f"https://raw.githubusercontent.com/{project}/{branch}/{path}"
    )
    res.raise_for_status()
    return res.text


def _url(s: str) -> str:
    from urllib.parse import quote
    return quote(s, safe="")


# ─── Helpers ──────────────────────────────────────────────────────────────


def _matches_globs(path: str, include: list[str], exclude: list[str]) -> bool:
    def to_re(pat: str) -> re.Pattern[str]:
        # Tiny ** / * matcher.
        escaped = re.escape(pat).replace(r"\*\*", "::DSTAR::").replace(r"\*", "[^/]*")
        escaped = escaped.replace("::DSTAR::", ".*")
        return re.compile("^" + escaped + "$")
    if not any(to_re(p).match(path) for p in include):
        return False
    if any(to_re(p).match(path) for p in exclude):
        return False
    return True


def _language_of(path: str) -> str:
    ext = path.rsplit(".", 1)[-1].lower() if "." in path else ""
    return {
        "ts": "typescript", "tsx": "typescript", "js": "javascript", "jsx": "javascript",
        "py": "python", "rb": "ruby", "go": "go", "java": "java", "kt": "kotlin",
        "rs": "rust", "sql": "sql", "md": "markdown", "json": "json",
        "yaml": "yaml", "yml": "yaml", "sh": "bash", "html": "html",
        "css": "css", "scss": "scss",
    }.get(ext, "txt")


def _compose_module_sample(group: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    budget = 12_000
    for f in group:
        head = (f["body"] or "")[: min(2_000, budget)]
        if not head:
            break
        parts.append(f"### {f['path']}\n\n```{f.get('language') or 'txt'}\n{head}\n```")
        budget -= len(head)
        if budget <= 0:
            break
    return "\n\n".join(parts)


_SLUG_BAD = re.compile(r"[^a-z0-9-]")


def _slugify(name: str) -> str:
    s = name.lower()
    s = re.sub(r"\s+", "-", s)
    s = _SLUG_BAD.sub("", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s or f"code-{abs(hash(name)) % 10_000_000}"


def _first_line_of(md: str) -> str | None:
    for line in md.split("\n"):
        t = line.strip()
        if not t or t.startswith("#"):
            continue
        return t[:200]
    return None
