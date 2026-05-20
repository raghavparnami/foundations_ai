"""Connections endpoints — v0.5 Vertical 1.

Behavioural parity with the legacy Next.js routes at:
    src/app/api/connections/route.ts
    src/app/api/connections/inspect/route.ts

Both apps write to the SAME `foundation_ai.sources` table, so flipping the
React frontend between :3001 (Next.js) and :8001 (this service) is a
one-line env change.

This vertical is pure Postgres — no LLM, no external HTTP.
"""
from typing import Any

import psycopg
from fastapi import APIRouter, HTTPException
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from app.db import get_conn

router = APIRouter(tags=["connections"])

# Schemas we never expose through inspect — system, ours, or noise.
SYSTEM_SCHEMAS: tuple[str, ...] = ("pg_catalog", "information_schema", "pg_toast")


# ─── Models ────────────────────────────────────────────────────────────────


class Source(BaseModel):
    id: int
    name: str
    kind: str
    conn_url: str  # redacted before serialization
    created_at: str
    total_tables: int
    ready_tables: int


class ListConnectionsResponse(BaseModel):
    sources: list[Source]


class CreateSourceBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: str = Field(default="postgres")
    conn_url: str = Field(min_length=1)
    included_tables: list[str] | None = None  # qualified "schema.name"


class CreateSourceResponse(BaseModel):
    id: int
    name: str
    included_tables: list[str] | None


class PreviewBody(BaseModel):
    conn_url: str
    kind: str = "postgres"


@router.post("/preview")
async def preview_source(body: PreviewBody) -> dict[str, Any]:
    """Read-only preview of tables visible at a Postgres URL.

    Port of src/app/api/connections/preview/route.ts. Doesn't touch the catalog.
    """
    if body.kind != "postgres":
        raise HTTPException(
            501,
            detail=(
                f"Preview for {body.kind} lands in v0.5. The connection still saves; "
                "projects can reference it."
            ),
        )
    url = body.conn_url.strip()
    if not url:
        raise HTTPException(400, detail="conn_url required")
    try:
        async with await psycopg.AsyncConnection.connect(url, connect_timeout=4) as conn:
            async with conn.cursor(row_factory=dict_row) as cur:
                await cur.execute(
                    """
                    SELECT
                      t.table_schema AS schema_name,
                      t.table_name,
                      t.table_type,
                      COALESCE(
                        (SELECT reltuples::bigint FROM pg_class
                           WHERE oid = (t.table_schema || '.' || t.table_name)::regclass),
                        0
                      )::int AS estimated_rows
                    FROM information_schema.tables t
                    WHERE t.table_schema NOT IN ('pg_catalog','information_schema','loom_views')
                      AND t.table_type IN ('BASE TABLE','VIEW')
                    ORDER BY t.table_schema, t.table_name
                    """
                )
                rows = await cur.fetchall()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, detail=f"Could not connect: {e}") from e
    return {"tables": rows}


class InspectBody(BaseModel):
    conn_url: str


class InspectTable(BaseModel):
    qualified: str
    name: str
    kind: str  # "table" | "view"
    row_estimate: int
    n_columns: int


class InspectSchema(BaseModel):
    schema_: str = Field(serialization_alias="schema")
    tables: list[InspectTable]


class InspectOk(BaseModel):
    ok: bool = True
    schemas: list[InspectSchema]
    total_tables: int


class InspectError(BaseModel):
    ok: bool = False
    error: str


# ─── Helpers ───────────────────────────────────────────────────────────────


def _redact(url: str) -> str:
    """Mirror the TS regex: `(:\\/\\/[^:]+:)([^@]+)(@)` → `$1•••$3`."""
    import re

    return re.sub(r"(://[^:]+:)([^@]+)(@)", r"\1•••\3", url)


# ─── Endpoints ─────────────────────────────────────────────────────────────


@router.get("", response_model=ListConnectionsResponse)
async def list_connections() -> ListConnectionsResponse:
    """List all configured source connections with table counts."""
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT s.id,
                       s.name,
                       s.kind,
                       s.conn_url,
                       s.created_at::text AS created_at,
                       (SELECT count(*)::int FROM tables t
                         WHERE t.source_id = s.id) AS total_tables,
                       (SELECT count(*)::int FROM tables t
                         WHERE t.source_id = s.id AND t.status = 'ready') AS ready_tables
                  FROM sources s
                 ORDER BY s.id
                """,
            )
            rows = await cur.fetchall()
    return ListConnectionsResponse(
        sources=[
            Source(
                id=r["id"],
                name=r["name"],
                kind=r["kind"],
                conn_url=_redact(r["conn_url"]),
                created_at=r["created_at"],
                total_tables=r["total_tables"],
                ready_tables=r["ready_tables"],
            )
            for r in rows
        ]
    )


@router.post("", response_model=CreateSourceResponse)
async def add_connection(body: CreateSourceBody) -> CreateSourceResponse:
    """Upsert a source by name. Optionally restrict to `included_tables`.

    Mirrors the legacy POST: ON CONFLICT (name) DO UPDATE both `conn_url` and
    `included_tables`, then writes an audit row.
    """
    if not body.name or not body.conn_url:
        raise HTTPException(400, "name and conn_url required")

    included: list[str] | None = (
        [s for s in body.included_tables if isinstance(s, str) and "." in s]
        if body.included_tables
        else None
    )
    if included is not None and len(included) == 0:
        # An empty array means "no qualifiers survived the filter" — legacy
        # behaviour is to treat that as "all tables", i.e. null.
        included = None

    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                INSERT INTO sources (name, kind, conn_url, included_tables)
                     VALUES (%s, %s, %s, %s::jsonb)
                ON CONFLICT (name) DO UPDATE
                   SET conn_url = EXCLUDED.conn_url,
                       included_tables = EXCLUDED.included_tables
                RETURNING id
                """,
                (
                    body.name,
                    body.kind,
                    body.conn_url,
                    Jsonb(included) if included is not None else None,
                ),
            )
            row = await cur.fetchone()
            if row is None:
                raise HTTPException(500, "insert returned no row")
            new_id = int(row["id"])

            await cur.execute(
                """
                INSERT INTO audit_log (actor, action, target, details)
                VALUES ('user', 'connection:add', %s, %s::jsonb)
                """,
                (
                    body.name,
                    Jsonb({"included": len(included) if included else "all"}),
                ),
            )

    return CreateSourceResponse(id=new_id, name=body.name, included_tables=included)


@router.post("/inspect")
async def inspect_connection(body: InspectBody) -> dict[str, Any]:
    """Peek at a Postgres URL — list schemas + tables BEFORE persisting.

    Opens a SEPARATE psycopg connection (not from the catalog pool), with a
    10s connect timeout and 10s statement timeout, and closes it cleanly in
    a finally. On error returns `{"ok": False, "error": "..."}` rather than
    raising — the frontend renders this inline.
    """
    url = body.conn_url.strip()
    if not url:
        return InspectError(error="conn_url required").model_dump()
    if not (url.startswith("postgres://") or url.startswith("postgresql://")):
        return InspectError(error="only postgres:// URLs supported").model_dump()

    conn: psycopg.AsyncConnection | None = None
    try:
        conn = await psycopg.AsyncConnection.connect(
            conninfo=url,
            autocommit=True,
            connect_timeout=10,
        )
        async with conn.cursor() as cur:
            await cur.execute("SET statement_timeout = 10000")

        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT t.table_schema,
                       t.table_name,
                       t.table_type,
                       COALESCE(c.reltuples::bigint::text, '0') AS row_estimate,
                       (SELECT count(*)::text FROM information_schema.columns ic
                         WHERE ic.table_schema = t.table_schema
                           AND ic.table_name   = t.table_name) AS n_columns
                  FROM information_schema.tables t
             LEFT JOIN pg_class c
                    ON c.oid = (quote_ident(t.table_schema) || '.' || quote_ident(t.table_name))::regclass
                 WHERE t.table_schema <> ALL(%s::text[])
                   AND t.table_schema NOT LIKE 'pg_%%'
                   AND t.table_type IN ('BASE TABLE', 'VIEW')
                 ORDER BY t.table_schema, t.table_name
                """,
                (list(SYSTEM_SCHEMAS),),
            )
            rows = await cur.fetchall()
    except Exception as e:
        return InspectError(error=str(e)).model_dump()
    finally:
        if conn is not None:
            try:
                await conn.close()
            except Exception:
                pass

    grouped: dict[str, list[InspectTable]] = {}
    for r in rows:
        schema_name = r["table_schema"]
        tables = grouped.setdefault(schema_name, [])
        tables.append(
            InspectTable(
                qualified=f"{schema_name}.{r['table_name']}",
                name=r["table_name"],
                kind="view" if r["table_type"] == "VIEW" else "table",
                row_estimate=int(r["row_estimate"]),
                n_columns=int(r["n_columns"]),
            )
        )

    schemas = [
        InspectSchema(schema_=k, tables=v) for k, v in sorted(grouped.items())
    ]
    return InspectOk(schemas=schemas, total_tables=len(rows)).model_dump(by_alias=True)
