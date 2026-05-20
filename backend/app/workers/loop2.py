"""Loop 2 — semantic enrichment.

Direct port of src/lib/worker/loop2.ts. For each profiled table:
  - Load the structural doc + a sample of rows + recent SQL the agent ran
  - Ask the doc-writer LLM to write the semantic half of the doc
  - Splice the LLM block in, preserving any human-tagged blocks
  - Persist the merged markdown back to docs.markdown

Uses the OpenAI-compatible llm.async_client() so OpenRouter or Databricks
both work — picked via LLM_PROVIDER in .env.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from ..audit import audit
from ..db import get_conn
from ..llm import async_client, chat_model_id, provider_label
from .markdown import count_provenance, provenance_wrap

log = logging.getLogger(__name__)

SYSTEM = """You are Loom, an assistant that writes precise, terse semantic
documentation for database tables. You are given a table's structural profile,
a sample of rows, and (if available) a "Recent agent queries on this table"
section drawn from the actual audit log of queries Loom has run. Use them.

Write a Markdown section that includes exactly:

  ## What this table represents
  One or two sentences. Domain-grounded, not generic.

  ## Common joins
  Bullet list of likely join targets. **Prefer joins you can see in the
  Recent queries section** — quote the JOIN ... ON clause verbatim where you
  can. Only fall back to FK/column-name inference if there are no recent
  queries. If still nothing, write "None obvious from this profile."

  ## Column meanings
  Bullet list, one per column. Skip self-explanatory IDs/timestamps unless
  there's something non-obvious. Format: `column_name` — meaning.

  ## Likely filter patterns
  Bullet list of WHERE clauses an analyst would commonly use. **Prefer
  filters you can see in the Recent queries section.** Otherwise infer from
  column types and top values. 2–4 items.

Write nothing outside these four sections. No preamble, no apologies, no
"As an AI". Use backticks for identifiers."""


@dataclass(slots=True)
class _Ctx:
    schema_name: str
    table_name: str
    markdown: str
    sample_rows: list[dict[str, Any]]
    recent_queries: list[str]


async def run_loop2_for_table(table_id: int, source_conn_url: str) -> None:
    ctx = await _load_context(table_id, source_conn_url)
    if ctx is None:
        return

    await _set_status(table_id, "enriching")
    log.info("loop2.start table=%s.%s", ctx.schema_name, ctx.table_name)

    user_msg = _render_prompt(ctx)
    client = async_client()
    resp = await client.chat.completions.create(
        model=chat_model_id(),
        messages=[
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": user_msg},
        ],
        temperature=0.2,
    )
    text = (resp.choices[0].message.content or "").strip() if resp.choices else ""

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    semantic_md = provenance_wrap(
        "claude",
        text,
        f"{today}, provider={provider_label()}, model={chat_model_id()}",
    )

    merged = _merge_into_doc(ctx.markdown, semantic_md)
    prov = count_provenance(merged)

    async with get_conn() as cat:
        async with cat.cursor() as cur:
            await cur.execute(
                """
                UPDATE docs SET markdown = %s, provenance = %s, updated_at = now()
                 WHERE table_id = %s
                """,
                (merged, Jsonb(prov), table_id),
            )
            await cur.execute(
                "UPDATE tables SET status = 'ready', last_enriched_at = now() WHERE id = %s",
                (table_id,),
            )

    await audit(
        "worker:loop2",
        "enrich_table",
        f"{ctx.schema_name}.{ctx.table_name}",
        {"bytes": len(semantic_md)},
    )
    log.info("loop2.done table=%s.%s bytes=%s", ctx.schema_name, ctx.table_name, len(semantic_md))


async def run_loop2_all(source_conn_url: str) -> None:
    """Re-enrich every table not yet ready."""
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT id FROM tables WHERE status IN ('profiled','enriching') ORDER BY id"
            )
            rows = await cur.fetchall()
    for (table_id,) in rows:
        try:
            await run_loop2_for_table(int(table_id), source_conn_url)
        except Exception as e:  # noqa: BLE001
            log.error("loop2.table_failed table_id=%s err=%s", table_id, e)
            async with get_conn() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(
                        "UPDATE tables SET status = 'profiled' WHERE id = %s", (table_id,)
                    )


async def run_loop2_for_tables(source_conn_url: str, table_ids: list[int]) -> None:
    """Re-enrich a specific set — used by the scheduler when Loop 1 reports a
    schema_hash change."""
    for tid in table_ids:
        try:
            await run_loop2_for_table(tid, source_conn_url)
            async with get_conn() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(
                        "UPDATE tables SET dirty = FALSE WHERE id = %s", (tid,)
                    )
        except Exception as e:  # noqa: BLE001
            log.error("loop2.table_failed table_id=%s err=%s", tid, e)
            async with get_conn() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(
                        "UPDATE tables SET status = 'profiled' WHERE id = %s", (tid,)
                    )


# ─── context loading + prompt assembly ────────────────────────────────────


async def _load_context(table_id: int, source_conn_url: str) -> _Ctx | None:
    async with get_conn() as cat:
        async with cat.cursor() as cur:
            await cur.execute(
                "SELECT schema_name, table_name FROM tables WHERE id = %s", (table_id,)
            )
            row = await cur.fetchone()
            if row is None:
                return None
            schema_name, table_name = row[0], row[1]

            await cur.execute("SELECT markdown FROM docs WHERE table_id = %s", (table_id,))
            doc_row = await cur.fetchone()
            if doc_row is None:
                return None
            markdown = doc_row[0]

            # Recent SQL the agent ran that referenced this table — ground the
            # "Common joins" and "Likely filter patterns" sections in real usage.
            pattern = f"%{table_name}%"
            await cur.execute(
                """
                SELECT (details->>'sql') AS sql
                  FROM audit_log
                 WHERE action = 'tool:run_sql'
                   AND details->>'sql' ILIKE %s
                 ORDER BY ts DESC
                 LIMIT 10
                """,
                (pattern,),
            )
            queries = [r[0] for r in await cur.fetchall() if r and r[0]]

    # Pull sample rows from the source DB.
    async with await psycopg.AsyncConnection.connect(source_conn_url) as src:
        async with src.cursor(row_factory=dict_row) as cur:
            await cur.execute(f'SELECT * FROM "{schema_name}"."{table_name}" LIMIT 5')
            samples = await cur.fetchall()

    return _Ctx(
        schema_name=schema_name,
        table_name=table_name,
        markdown=markdown,
        sample_rows=samples,
        recent_queries=queries,
    )


def _render_prompt(ctx: _Ctx) -> str:
    query_block = ""
    if ctx.recent_queries:
        formatted = "\n\n".join(
            f"### Query {i + 1}\n```sql\n{q}\n```"
            for i, q in enumerate(ctx.recent_queries)
        )
        query_block = (
            "\n## Recent agent queries on this table\n"
            "Use these to ground the 'Common joins' and 'Likely filter patterns'\n"
            "sections in real usage. Quote join keys and WHERE clauses you actually\n"
            "observe; ignore one-offs.\n\n" + formatted
        )

    return "\n".join(
        [
            f"# Structural profile of `{ctx.schema_name}.{ctx.table_name}`",
            "",
            ctx.markdown,
            "",
            "## Sample rows (up to 5)",
            "",
            "```json",
            json.dumps(ctx.sample_rows, default=_json_default, indent=2),
            "```",
            query_block,
        ]
    )


def _json_default(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


# ─── merge helper — preserves human blocks, replaces claude blocks ────────


_BLOCK_HEADER_RE = re.compile(r"^<!--\s*provenance:\s*(schema|query-log|claude|human)")


def _split_blocks(markdown: str) -> list[tuple[str | None, str]]:
    lines = markdown.split("\n")
    out: list[tuple[str | None, str]] = []
    cur: list[str] = []
    cur_prov: str | None = None
    for line in lines:
        m = _BLOCK_HEADER_RE.match(line)
        if m:
            if cur:
                out.append((cur_prov, "\n".join(cur)))
                cur = []
            cur_prov = m.group(1)
        cur.append(line)
    if cur:
        out.append((cur_prov, "\n".join(cur)))
    return out


_TITLE_RE = re.compile(r"^#\s", re.MULTILINE)


def _merge_into_doc(existing: str, semantic_block: str) -> str:
    """Replace any existing claude blocks with the new semantic block. Insert
    after the first non-title schema block (the summary), preserving humans."""
    kept = [(prov, raw) for prov, raw in _split_blocks(existing) if prov != "claude"]
    out: list[str] = []
    inserted = False
    for prov, raw in kept:
        out.append(raw)
        if not inserted and prov == "schema" and not _TITLE_RE.search(raw):
            out.append(semantic_block)
            inserted = True
    if not inserted:
        out.append(semantic_block)
    return "\n".join(out)


async def _set_status(table_id: int, status: str) -> None:
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE tables SET status = %s WHERE id = %s", (status, table_id)
            )
