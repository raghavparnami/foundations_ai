"""Catalog DB pool.

One process-wide `AsyncConnectionPool` against `loom_catalog`. Every checkout
runs `SET search_path TO foundation_ai, public` so the rest of the codebase
can write unqualified SQL — same convention the legacy Node app uses.

Source DBs (the user's warehouses) are NOT pooled here — they are opened
per-request inside the inspect flow and closed immediately. We never keep a
long-lived pool to a user-controlled URL.

Public surface:
    startup_pool() / shutdown_pool()   — lifespan hooks
    get_conn()                         — async context manager → AsyncConnection
    query(sql, args)                   — convenience helper → list[dict]
    show_search_path()                 — verifies the search_path is correct
"""
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Sequence

from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from app.config import get_settings

_pool: AsyncConnectionPool | None = None


async def _configure(conn: AsyncConnection) -> None:
    await conn.set_autocommit(True)
    async with conn.cursor() as cur:
        await cur.execute("SET search_path TO foundation_ai, public")


def _get_pool() -> AsyncConnectionPool:
    global _pool
    if _pool is None:
        settings = get_settings()
        _pool = AsyncConnectionPool(
            conninfo=settings.catalog_url,
            min_size=1,
            max_size=8,
            kwargs={"autocommit": True},
            configure=_configure,
            open=False,
        )
    return _pool


async def startup_pool() -> None:
    pool = _get_pool()
    await pool.open()
    await pool.wait()
    # Verify search_path is what we expect on a fresh checkout — this catches
    # mis-configured roles or PgBouncer in front of us early, not at the first
    # query.
    sp = await show_search_path()
    if "foundation_ai" not in sp:
        raise RuntimeError(
            f"search_path is {sp!r}; expected to include 'foundation_ai'. "
            "Check the loom role's default search_path."
        )


async def shutdown_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


@asynccontextmanager
async def get_conn() -> AsyncIterator[AsyncConnection]:
    """Borrow a configured connection from the catalog pool."""
    pool = _get_pool()
    async with pool.connection() as conn:
        yield conn


async def query(sql: str, args: Sequence[Any] | None = None) -> list[dict[str, Any]]:
    """Run a SELECT (or RETURNING) and get a list of row dicts."""
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(sql, args or ())
            return await cur.fetchall()


async def show_search_path() -> str:
    """Return the literal value Postgres reports for `SHOW search_path`."""
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute("SHOW search_path")
            row = await cur.fetchone()
    return row[0] if row else ""
