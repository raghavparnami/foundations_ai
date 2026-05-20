"""Projects = scoped workspaces pinning a subset of catalog tables.

Port of src/lib/catalog/projects.ts. When the chat has an active project,
agent tools filter to those tables; out-of-scope tables are still profiled
in the background, just hidden until scope is expanded.
"""
from __future__ import annotations

from typing import Any

from psycopg.rows import dict_row

from ..db import get_conn


async def list_projects() -> list[dict[str, Any]]:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT id, slug, name, description, created_at, updated_at
                  FROM projects ORDER BY updated_at DESC
                """
            )
            return await cur.fetchall()


async def get_project(slug: str) -> dict[str, Any] | None:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT id, slug, name, description, created_at, updated_at
                  FROM projects WHERE slug = %s
                """,
                (slug,),
            )
            project = await cur.fetchone()
            if not project:
                return None
            await cur.execute(
                "SELECT table_id FROM project_tables WHERE project_id = %s",
                (project["id"],),
            )
            tables = await cur.fetchall()
    project["table_ids"] = [int(t["table_id"]) for t in tables]
    return project


async def upsert_project(
    *,
    slug: str,
    name: str,
    description: str | None,
    table_ids: list[int],
) -> dict[str, Any]:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                INSERT INTO projects (slug, name, description, updated_at)
                     VALUES (%s, %s, %s, now())
                ON CONFLICT (slug) DO UPDATE
                  SET name = EXCLUDED.name,
                      description = EXCLUDED.description,
                      updated_at = now()
                RETURNING id, slug, name, description, created_at, updated_at
                """,
                (slug, name, description),
            )
            project = await cur.fetchone()
            assert project is not None
            await cur.execute(
                "DELETE FROM project_tables WHERE project_id = %s",
                (project["id"],),
            )
            for tid in table_ids:
                await cur.execute(
                    "INSERT INTO project_tables (project_id, table_id) VALUES (%s, %s)",
                    (project["id"], tid),
                )
    project["table_ids"] = list(table_ids)
    return project


async def delete_project(slug: str) -> None:
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute("DELETE FROM projects WHERE slug = %s", (slug,))


async def project_table_ids(slug: str | None) -> list[int] | None:
    """None signals 'no project filter' (full-catalog scope)."""
    if not slug:
        return None
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT pt.table_id
                  FROM project_tables pt
                  JOIN projects p ON p.id = pt.project_id
                 WHERE p.slug = %s
                """,
                (slug,),
            )
            rows = await cur.fetchall()
    if not rows:
        return None
    return [int(r[0]) for r in rows]
