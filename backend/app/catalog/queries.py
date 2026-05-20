"""Read helpers for the catalog DB.

Port of src/lib/catalog/queries.ts. Used by REST routes and agent tools alike;
keep these focused on a single table fetch each so callers can compose them.
"""
from __future__ import annotations

from typing import Any

from psycopg.rows import dict_row

from ..db import get_conn


async def list_sources() -> list[dict[str, Any]]:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                "SELECT id, name, kind, conn_url, created_at FROM sources ORDER BY id"
            )
            return await cur.fetchall()


async def list_tables_with_counts() -> list[dict[str, Any]]:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT t.id, t.source_id, t.schema_name, t.table_name, t.row_count,
                       t.status, t.last_profiled_at, t.last_enriched_at,
                       s.name AS source_name,
                       (SELECT count(*)::int FROM columns c WHERE c.table_id = t.id) AS column_count
                  FROM tables t
                  JOIN sources s ON s.id = t.source_id
                 ORDER BY t.source_id, t.table_name
                """
            )
            return await cur.fetchall()


async def get_table(table_id: int) -> dict[str, Any] | None:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT id, source_id, schema_name, table_name, row_count, status,
                       last_profiled_at, last_enriched_at
                  FROM tables WHERE id = %s
                """,
                (table_id,),
            )
            row = await cur.fetchone()
    return row


async def get_table_by_name(source_name: str, table_name: str) -> dict[str, Any] | None:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT t.id, t.source_id, t.schema_name, t.table_name, t.row_count,
                       t.status, t.last_profiled_at, t.last_enriched_at
                  FROM tables t
                  JOIN sources s ON s.id = t.source_id
                 WHERE s.name = %s AND t.table_name = %s
                """,
                (source_name, table_name),
            )
            return await cur.fetchone()


async def list_columns(table_id: int) -> list[dict[str, Any]]:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT id, table_id, column_name, ordinal, data_type, is_nullable,
                       is_primary, fk_target
                  FROM columns WHERE table_id = %s ORDER BY ordinal
                """,
                (table_id,),
            )
            return await cur.fetchall()


async def get_profiles_for_table(table_id: int) -> dict[int, dict[str, Any]]:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT p.id, p.column_id, p.null_rate, p.distinct_count, p.min_value,
                       p.max_value, p.top_values, p.histogram, p.sample_values, p.profiled_at
                  FROM column_profiles p
                  JOIN columns c ON c.id = p.column_id
                 WHERE c.table_id = %s
                """,
                (table_id,),
            )
            rows = await cur.fetchall()
    return {row["column_id"]: row for row in rows}


async def get_doc(table_id: int) -> dict[str, Any] | None:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT id, table_id, path, markdown, provenance, updated_at
                  FROM docs WHERE table_id = %s
                """,
                (table_id,),
            )
            return await cur.fetchone()


async def recent_audit(limit: int = 50) -> list[dict[str, Any]]:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT id, ts, actor, action, target, details
                  FROM audit_log ORDER BY ts DESC LIMIT %s
                """,
                (limit,),
            )
            return await cur.fetchall()
