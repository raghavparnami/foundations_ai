"""Loop 1 — structural crawl.

Direct port of src/lib/worker/loop1.ts. For each table in the source DB:
discover columns + FKs, profile each column, write rows into the catalog
(foundation_ai.{tables,columns,column_profiles,docs}), and persist the
structural markdown doc.

Modes:
    full  — re-profile every table unconditionally
    delta — skip tables whose schema_hash hasn't changed (used by scheduler)

Returns the table ids that were touched so Loop 2 can target them precisely.
"""
from __future__ import annotations

import hashlib
import logging
import time
from dataclasses import dataclass
from typing import Literal

import psycopg
from psycopg.types.json import Jsonb

from ..audit import audit
from ..db import get_conn
from .markdown import count_provenance, render_structural_doc
from .source_pg import ColumnProfile, SourceTable, list_tables, profile_column

log = logging.getLogger(__name__)


@dataclass(slots=True)
class Loop1Result:
    profiled: list[int]
    dirty: list[int]


def _compute_schema_hash(t: SourceTable) -> str:
    sig = "\n".join(
        f"{c.column_name}|{c.data_type}|{c.is_nullable}|{c.is_primary}|{c.fk_target or ''}"
        for c in sorted(t.columns, key=lambda c: c.ordinal)
    )
    return hashlib.md5(sig.encode("utf-8")).hexdigest()


async def ensure_source(name: str, kind: str, conn_url: str) -> int:
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO sources (name, kind, conn_url)
                     VALUES (%s, %s, %s)
                ON CONFLICT (name) DO UPDATE SET conn_url = EXCLUDED.conn_url
                RETURNING id
                """,
                (name, kind, conn_url),
            )
            row = await cur.fetchone()
    assert row is not None
    return int(row[0])


async def run_loop1(
    source_id: int,
    source_conn_url: str,
    schema: str = "public",
    mode: Literal["full", "delta"] = "full",
) -> Loop1Result:
    started = time.monotonic()
    log.info("loop1.start source_id=%s schema=%s mode=%s", source_id, schema, mode)

    # One short-lived connection to the source for the whole crawl.
    async with await psycopg.AsyncConnection.connect(source_conn_url) as src:
        all_tables = await list_tables(src, schema)

        # Apply the source's `included_tables` allowlist if any.
        async with get_conn() as cat:
            async with cat.cursor() as cur:
                await cur.execute(
                    "SELECT included_tables FROM sources WHERE id = %s", (source_id,)
                )
                row = await cur.fetchone()
        allow: list[str] | None = (row[0] if row else None) or None
        tables = (
            [t for t in all_tables if f"{t.schema_name}.{t.table_name}" in set(allow)]
            if allow
            else all_tables
        )

        log.info(
            "loop1.tables_discovered count=%s total=%s allow_size=%s",
            len(tables),
            len(all_tables),
            len(allow) if allow else None,
        )

        profiled: list[int] = []
        dirty: list[int] = []

        # Upsert table rows up front so the UI can render them as pending.
        async with get_conn() as cat:
            async with cat.cursor() as cur:
                for t in tables:
                    await cur.execute(
                        """
                        INSERT INTO tables (source_id, schema_name, table_name, row_count, status)
                             VALUES (%s, %s, %s, %s, 'pending')
                        ON CONFLICT (source_id, schema_name, table_name) DO UPDATE
                          SET row_count = EXCLUDED.row_count
                        """,
                        (source_id, t.schema_name, t.table_name, t.row_count),
                    )

        for t in tables:
            table_id = await _get_table_id(source_id, t.schema_name, t.table_name)
            new_hash = _compute_schema_hash(t)
            old_hash, _status = await _get_hash_status(table_id)

            if mode == "delta":
                if old_hash is None:
                    # First-time backfill: record the hash so future ticks compare.
                    await _set_schema_hash(table_id, new_hash)
                    continue
                if old_hash == new_hash:
                    continue
                # Schema changed — mark dirty, will re-profile + re-enrich.
                await _mark_dirty(table_id)
                dirty.append(table_id)
                await audit(
                    "worker:loop1",
                    "schema_changed",
                    f"{t.schema_name}.{t.table_name}",
                    {"old_hash": old_hash[:8], "new_hash": new_hash[:8]},
                )

            await _profile_one_table(source_id, src, t, new_hash)
            profiled.append(table_id)

    log.info(
        "loop1.done source_id=%s ms=%s profiled=%s dirty=%s",
        source_id,
        int((time.monotonic() - started) * 1000),
        len(profiled),
        len(dirty),
    )
    return Loop1Result(profiled=profiled, dirty=dirty)


async def _profile_one_table(
    source_id: int,
    src: psycopg.AsyncConnection,
    t: SourceTable,
    schema_hash: str,
) -> None:
    table_id = await _get_table_id(source_id, t.schema_name, t.table_name)
    await _set_status(table_id, "profiling")

    # Drop columns that no longer exist in source.
    live = {c.column_name for c in t.columns}
    async with get_conn() as cat:
        async with cat.cursor() as cur:
            await cur.execute(
                "SELECT id, column_name FROM columns WHERE table_id = %s", (table_id,)
            )
            stale = await cur.fetchall()
    for col_id, col_name in stale:
        if col_name not in live:
            async with get_conn() as cat:
                async with cat.cursor() as cur:
                    await cur.execute("DELETE FROM columns WHERE id = %s", (col_id,))
            await audit(
                "worker:loop1",
                "column_dropped",
                f"{t.schema_name}.{t.table_name}.{col_name}",
            )

    # Upsert columns.
    async with get_conn() as cat:
        async with cat.cursor() as cur:
            for c in t.columns:
                await cur.execute(
                    """
                    INSERT INTO columns (table_id, column_name, ordinal, data_type,
                                         is_nullable, is_primary, fk_target)
                         VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (table_id, column_name) DO UPDATE
                      SET ordinal = EXCLUDED.ordinal,
                          data_type = EXCLUDED.data_type,
                          is_nullable = EXCLUDED.is_nullable,
                          is_primary = EXCLUDED.is_primary,
                          fk_target = EXCLUDED.fk_target
                    """,
                    (
                        table_id,
                        c.column_name,
                        c.ordinal,
                        c.data_type,
                        c.is_nullable,
                        c.is_primary,
                        c.fk_target,
                    ),
                )

    # Profile each column individually so one failure doesn't blow up the table.
    profiles: dict[str, ColumnProfile] = {}
    for c in t.columns:
        try:
            p = await profile_column(
                src, t.schema_name, t.table_name, c.column_name, c.data_type, t.row_count
            )
        except Exception as e:  # noqa: BLE001 — we want to keep going on a per-column basis
            log.warning(
                "loop1.profile_column_failed table=%s column=%s err=%s",
                t.table_name,
                c.column_name,
                e,
            )
            continue
        profiles[c.column_name] = p
        col_id = await _get_column_id(table_id, c.column_name)
        async with get_conn() as cat:
            async with cat.cursor() as cur:
                await cur.execute(
                    """
                    INSERT INTO column_profiles
                        (column_id, null_rate, distinct_count, min_value, max_value,
                         top_values, histogram, sample_values, profiled_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, now())
                    ON CONFLICT (column_id) DO UPDATE
                      SET null_rate = EXCLUDED.null_rate,
                          distinct_count = EXCLUDED.distinct_count,
                          min_value = EXCLUDED.min_value,
                          max_value = EXCLUDED.max_value,
                          top_values = EXCLUDED.top_values,
                          histogram = EXCLUDED.histogram,
                          sample_values = EXCLUDED.sample_values,
                          profiled_at = now()
                    """,
                    (
                        col_id,
                        p.null_rate,
                        p.distinct_count,
                        p.min_value,
                        p.max_value,
                        Jsonb([{"value": tv.value, "count": tv.count} for tv in p.top_values]),
                        Jsonb([{"bin": h.bin, "count": h.count} for h in p.histogram])
                        if p.histogram
                        else None,
                        Jsonb(p.sample_values),
                    ),
                )

    # Render + persist the structural doc.
    md = render_structural_doc(t, profiles)
    source_name = await _get_source_name(source_id)
    path = f"wiki://{source_name}/{t.schema_name}/{t.table_name}"
    async with get_conn() as cat:
        async with cat.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO docs (table_id, path, markdown, provenance, updated_at)
                     VALUES (%s, %s, %s, %s, now())
                ON CONFLICT (table_id) DO UPDATE
                  SET path = EXCLUDED.path,
                      markdown = EXCLUDED.markdown,
                      provenance = EXCLUDED.provenance,
                      updated_at = now()
                """,
                (table_id, path, md, Jsonb(count_provenance(md))),
            )
            await cur.execute(
                "UPDATE tables SET last_profiled_at = now(), schema_hash = %s WHERE id = %s",
                (schema_hash, table_id),
            )

    await _set_status(table_id, "profiled")
    await audit(
        "worker:loop1",
        "profile_table",
        f"{t.schema_name}.{t.table_name}",
        {"columns": len(t.columns), "row_count": t.row_count, "schema_hash": schema_hash[:8]},
    )


# ─── tiny catalog helpers ──────────────────────────────────────────────────


async def _get_table_id(source_id: int, schema: str, table: str) -> int:
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT id FROM tables WHERE source_id = %s AND schema_name = %s AND table_name = %s",
                (source_id, schema, table),
            )
            row = await cur.fetchone()
    assert row is not None
    return int(row[0])


async def _get_column_id(table_id: int, column_name: str) -> int:
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT id FROM columns WHERE table_id = %s AND column_name = %s",
                (table_id, column_name),
            )
            row = await cur.fetchone()
    assert row is not None
    return int(row[0])


async def _get_source_name(source_id: int) -> str:
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute("SELECT name FROM sources WHERE id = %s", (source_id,))
            row = await cur.fetchone()
    assert row is not None
    return str(row[0])


async def _get_hash_status(table_id: int) -> tuple[str | None, str]:
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT schema_hash, status FROM tables WHERE id = %s", (table_id,)
            )
            row = await cur.fetchone()
    if row is None:
        return None, "pending"
    return (row[0], row[1])


async def _set_schema_hash(table_id: int, schema_hash: str) -> None:
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE tables SET schema_hash = %s WHERE id = %s", (schema_hash, table_id)
            )


async def _set_status(table_id: int, status: str) -> None:
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE tables SET status = %s WHERE id = %s", (status, table_id)
            )


async def _mark_dirty(table_id: int) -> None:
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE tables SET dirty = TRUE WHERE id = %s", (table_id,)
            )
