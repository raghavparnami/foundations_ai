"""Audit-log helper.

Every worker + agent action writes a row into foundation_ai.audit_log. The
shape mirrors the Node app exactly so both runtimes can share the table:

    (ts, actor, action, target, details JSONB)
"""
from __future__ import annotations

from typing import Any

from psycopg.types.json import Jsonb

from .db import get_conn


async def audit(
    actor: str,
    action: str,
    target: str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO audit_log (actor, action, target, details)
                     VALUES (%s, %s, %s, %s)
                """,
                (actor, action, target, Jsonb(details or {})),
            )
