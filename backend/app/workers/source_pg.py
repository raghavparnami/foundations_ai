"""Postgres source connector.

Direct port of src/lib/worker/source-pg.ts. Reads schema + samples from a
user-connected Postgres database. Source DBs are opened per-call and closed
immediately — we never keep a long-lived pool to a user-owned URL.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Sequence

import psycopg
from psycopg.rows import dict_row


@dataclass(slots=True)
class SourceColumn:
    column_name: str
    ordinal: int
    data_type: str
    is_nullable: bool
    is_primary: bool
    fk_target: str | None


@dataclass(slots=True)
class SourceTable:
    schema_name: str
    table_name: str
    columns: list[SourceColumn]
    row_count: int


@dataclass(slots=True)
class TopValue:
    value: str
    count: int


@dataclass(slots=True)
class HistogramBin:
    bin: str
    count: int


@dataclass(slots=True)
class ColumnProfile:
    null_rate: float
    distinct_count: int
    min_value: str | None
    max_value: str | None
    top_values: list[TopValue]
    histogram: list[HistogramBin] | None
    sample_values: list[str]


NUMERIC_TYPES: frozenset[str] = frozenset({
    "smallint", "integer", "bigint", "decimal", "numeric", "real",
    "double precision", "serial", "bigserial",
})

COMPARABLE_TYPES: frozenset[str] = frozenset({
    "smallint", "integer", "bigint", "decimal", "numeric", "real", "double precision",
    "serial", "bigserial",
    "text", "character varying", "character", "varchar", "char", "name", "citext",
    "date", "time", "time without time zone", "time with time zone",
    "timestamp", "timestamp without time zone", "timestamp with time zone",
    "uuid", "inet", "cidr",
})


def _qid(s: str) -> str:
    return '"' + s.replace('"', '""') + '"'


async def list_tables(conn: psycopg.AsyncConnection, schema: str = "public") -> list[SourceTable]:
    """Introspect every BASE TABLE in `schema` — columns, PK, FKs, row count."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            SELECT table_name FROM information_schema.tables
             WHERE table_schema = %s AND table_type = 'BASE TABLE'
             ORDER BY table_name
            """,
            (schema,),
        )
        table_rows = await cur.fetchall()

    tables: list[SourceTable] = []
    for t in table_rows:
        tname: str = t["table_name"]
        cols = await _fetch_columns(conn, schema, tname)
        pks = await _fetch_pk(conn, schema, tname)
        fks = await _fetch_fks(conn, schema, tname)
        rc = await _fetch_row_count(conn, schema, tname)

        tables.append(
            SourceTable(
                schema_name=schema,
                table_name=tname,
                row_count=rc,
                columns=[
                    SourceColumn(
                        column_name=c["column_name"],
                        ordinal=c["ordinal_position"],
                        data_type=c["data_type"],
                        is_nullable=(c["is_nullable"] == "YES"),
                        is_primary=(c["column_name"] in pks),
                        fk_target=fks.get(c["column_name"]),
                    )
                    for c in cols
                ],
            )
        )
    return tables


async def _fetch_columns(
    conn: psycopg.AsyncConnection, schema: str, table: str
) -> list[dict[str, Any]]:
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            SELECT column_name, ordinal_position, data_type, is_nullable
              FROM information_schema.columns
             WHERE table_schema = %s AND table_name = %s
             ORDER BY ordinal_position
            """,
            (schema, table),
        )
        return await cur.fetchall()


async def _fetch_pk(conn: psycopg.AsyncConnection, schema: str, table: str) -> set[str]:
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            SELECT a.attname AS column_name
              FROM pg_index i
              JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
             WHERE i.indrelid = (%s::regclass) AND i.indisprimary
            """,
            (f"{schema}.{table}",),
        )
        return {r["column_name"] for r in await cur.fetchall()}


async def _fetch_fks(
    conn: psycopg.AsyncConnection, schema: str, table: str
) -> dict[str, str]:
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            SELECT kcu.column_name,
                   ccu.table_schema AS ref_schema,
                   ccu.table_name   AS ref_table,
                   ccu.column_name  AS ref_column
              FROM information_schema.table_constraints tc
              JOIN information_schema.key_column_usage kcu
                ON kcu.constraint_name = tc.constraint_name
               AND kcu.table_schema = tc.table_schema
              JOIN information_schema.constraint_column_usage ccu
                ON ccu.constraint_name = tc.constraint_name
               AND ccu.table_schema = tc.table_schema
             WHERE tc.constraint_type = 'FOREIGN KEY'
               AND tc.table_schema = %s AND tc.table_name = %s
            """,
            (schema, table),
        )
        rows = await cur.fetchall()
    return {
        r["column_name"]: f"{r['ref_schema']}.{r['ref_table']}.{r['ref_column']}"
        for r in rows
    }


async def _fetch_row_count(conn: psycopg.AsyncConnection, schema: str, table: str) -> int:
    async with conn.cursor() as cur:
        await cur.execute(f"SELECT count(*)::text FROM {_qid(schema)}.{_qid(table)}")
        row = await cur.fetchone()
    return int(row[0]) if row else 0


async def profile_column(
    conn: psycopg.AsyncConnection,
    schema: str,
    table: str,
    column: str,
    data_type: str,
    row_count: int,
) -> ColumnProfile:
    """Per-column stats: null rate, distinct count, min/max, top-5, samples,
    and a 10-bin histogram for numeric columns. Every query swallows its own
    errors so a single unprofilable column doesn't blow up the whole table.
    """
    t = f"{_qid(schema)}.{_qid(table)}"
    c = _qid(column)

    null_rate, distinct = await _null_and_distinct(conn, t, c)
    min_value, max_value = await _min_max(conn, t, c, data_type)
    top_values = await _top_values(conn, t, c)
    samples = await _samples(conn, t, c)
    histogram = await _histogram(conn, t, c, data_type, row_count)

    return ColumnProfile(
        null_rate=null_rate,
        distinct_count=distinct,
        min_value=min_value,
        max_value=max_value,
        top_values=top_values,
        histogram=histogram,
        sample_values=samples,
    )


async def _null_and_distinct(
    conn: psycopg.AsyncConnection, t: str, c: str
) -> tuple[float, int]:
    async with conn.cursor() as cur:
        await cur.execute(
            f"""
            SELECT
              COALESCE((count(*) FILTER (WHERE {c} IS NULL))::float
                       / NULLIF(count(*), 0), 0)::text AS null_rate,
              count(DISTINCT {c}::text)::text AS distinct
            FROM {t}
            """
        )
        row = await cur.fetchone()
    if not row:
        return 0.0, 0
    return float(row[0] or 0.0), int(row[1] or 0)


async def _min_max(
    conn: psycopg.AsyncConnection, t: str, c: str, data_type: str
) -> tuple[str | None, str | None]:
    if data_type not in COMPARABLE_TYPES:
        return None, None
    try:
        async with conn.cursor() as cur:
            await cur.execute(f"SELECT min({c})::text, max({c})::text FROM {t}")
            row = await cur.fetchone()
        return (row[0], row[1]) if row else (None, None)
    except psycopg.Error:
        return None, None


async def _top_values(conn: psycopg.AsyncConnection, t: str, c: str) -> list[TopValue]:
    try:
        async with conn.cursor() as cur:
            await cur.execute(
                f"""
                SELECT {c}::text AS value, count(*)::text AS count
                  FROM {t}
                 WHERE {c} IS NOT NULL
                 GROUP BY {c}::text
                 ORDER BY count(*) DESC
                 LIMIT 5
                """
            )
            rows = await cur.fetchall()
        return [TopValue(value=r[0], count=int(r[1])) for r in rows]
    except psycopg.Error:
        return []


async def _samples(conn: psycopg.AsyncConnection, t: str, c: str) -> list[str]:
    try:
        async with conn.cursor() as cur:
            await cur.execute(
                f"""
                SELECT DISTINCT {c}::text AS v FROM {t}
                 WHERE {c} IS NOT NULL
                 ORDER BY v LIMIT 5
                """
            )
            rows = await cur.fetchall()
        return [r[0] for r in rows]
    except psycopg.Error:
        return []


async def _histogram(
    conn: psycopg.AsyncConnection, t: str, c: str, data_type: str, row_count: int
) -> list[HistogramBin] | None:
    if data_type not in NUMERIC_TYPES or row_count <= 0:
        return None
    try:
        async with conn.cursor() as cur:
            await cur.execute(
                f"""
                WITH bounds AS (
                  SELECT min({c})::float8 AS lo, max({c})::float8 AS hi FROM {t}
                )
                SELECT
                  width_bucket({c}::float8, b.lo, b.hi + 1e-9, 10)::text AS bucket,
                  count(*)::text AS count
                  FROM {t}, bounds b
                 WHERE {c} IS NOT NULL
                 GROUP BY 1 ORDER BY 1
                """
            )
            rows = await cur.fetchall()
        return [HistogramBin(bin=r[0], count=int(r[1])) for r in rows]
    except psycopg.Error:
        return None


async def sample_rows(
    conn: psycopg.AsyncConnection, schema: str, table: str, limit: int = 5
) -> list[dict[str, Any]]:
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            f"SELECT * FROM {_qid(schema)}.{_qid(table)} LIMIT %s", (limit,)
        )
        return await cur.fetchall()
