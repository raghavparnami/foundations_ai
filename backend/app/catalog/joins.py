"""Joins graph — declared FKs, observed joins, and confidence-ranked retrieval.

Port of src/lib/catalog/joins.ts. Three writers feed this:
  - FK backfill: walks columns.fk_target on every push (confidence 1.0)
  - Observed-join mining (Loop 3): parses agent SQL
  - Name-match heuristics (also Loop 3)
"""
from __future__ import annotations

from typing import Any

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from ..db import get_conn


async def upsert_join(
    *,
    from_table_id: int,
    to_table_id: int,
    from_columns: list[str],
    to_columns: list[str],
    source: str,
    confidence: float,
    cardinality: str | None = None,
    notes: str | None = None,
) -> None:
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO joins
                    (from_table_id, to_table_id, from_columns, to_columns,
                     cardinality, confidence, source, observed_count, last_seen_at, notes)
                VALUES (%s, %s, %s, %s, %s, %s, %s, 1, NOW(), %s)
                ON CONFLICT (from_table_id, to_table_id, from_columns, to_columns)
                DO UPDATE SET
                  confidence     = GREATEST(joins.confidence, EXCLUDED.confidence),
                  source         = CASE WHEN EXCLUDED.confidence > joins.confidence
                                        THEN EXCLUDED.source ELSE joins.source END,
                  observed_count = joins.observed_count + 1,
                  last_seen_at   = NOW(),
                  cardinality    = COALESCE(EXCLUDED.cardinality, joins.cardinality),
                  notes          = COALESCE(EXCLUDED.notes, joins.notes),
                  updated_at     = NOW()
                """,
                (
                    from_table_id, to_table_id,
                    Jsonb(from_columns), Jsonb(to_columns),
                    cardinality, confidence, source, notes,
                ),
            )


_JOIN_SELECT = """
SELECT j.id, j.from_table_id, j.to_table_id,
       j.from_columns, j.to_columns, j.cardinality,
       j.confidence::float8 AS confidence,
       j.source, j.observed_count,
       j.last_seen_at::text AS last_seen_at, j.notes,
       ft.schema_name || '.' || ft.table_name AS from_qualified,
       tt.schema_name || '.' || tt.table_name AS to_qualified
  FROM joins j
  JOIN tables ft ON ft.id = j.from_table_id
  JOIN tables tt ON tt.id = j.to_table_id
"""


async def list_joins_for_table(table_id: int) -> list[dict[str, Any]]:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                _JOIN_SELECT
                + " WHERE j.from_table_id = %s "
                "ORDER BY j.confidence DESC, j.observed_count DESC",
                (table_id,),
            )
            return await cur.fetchall()


async def resolve_join_pair(from_qualified: str, to_qualified: str) -> dict[str, Any] | None:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                _JOIN_SELECT
                + """
                WHERE (ft.schema_name || '.' || ft.table_name = %s
                       AND tt.schema_name || '.' || tt.table_name = %s)
                   OR (ft.schema_name || '.' || ft.table_name = %s
                       AND tt.schema_name || '.' || tt.table_name = %s)
                ORDER BY j.confidence DESC, j.observed_count DESC
                LIMIT 1
                """,
                (from_qualified, to_qualified, to_qualified, from_qualified),
            )
            return await cur.fetchone()


async def backfill_fk_joins() -> int:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT c.table_id AS from_table_id,
                       c.column_name AS from_column,
                       c.fk_target
                  FROM columns c
                 WHERE c.fk_target IS NOT NULL AND c.fk_target <> ''
                """
            )
            rows = await cur.fetchall()

    inserted = 0
    for r in rows:
        parts = (r["fk_target"] or "").split(".")
        if len(parts) < 3:
            continue
        target_col = parts[-1]
        target_table = parts[-2]
        target_schema = ".".join(parts[:-2])

        async with get_conn() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT id FROM tables WHERE schema_name = %s AND table_name = %s LIMIT 1",
                    (target_schema, target_table),
                )
                row = await cur.fetchone()
        if not row:
            continue
        to_id = int(row[0])

        await upsert_join(
            from_table_id=int(r["from_table_id"]),
            to_table_id=to_id,
            from_columns=[r["from_column"]],
            to_columns=[target_col],
            source="fk",
            confidence=1.0,
            cardinality="1:N",
        )
        await upsert_join(
            from_table_id=to_id,
            to_table_id=int(r["from_table_id"]),
            from_columns=[target_col],
            to_columns=[r["from_column"]],
            source="fk",
            confidence=1.0,
            cardinality="1:N",
        )
        inserted += 2
    return inserted


async def render_common_joins_md(table_id: int) -> str:
    joins = await list_joins_for_table(table_id)
    if not joins:
        return "_No joins recorded yet._"
    lines: list[str] = []
    for j in joins:
        from_cols = ", ".join(j["from_columns"] or [])
        to_cols = ", ".join(j["to_columns"] or [])
        source_tag = "FK" if j["source"] == "fk" else j["source"].upper()
        conf = f"{float(j['confidence']):.2f}"
        seen = f", seen {j['observed_count']}×" if j["observed_count"] else ""
        lines.append(
            f"- `JOIN {j['to_qualified']} ON {j['from_qualified']}.{from_cols} = "
            f"{j['to_qualified']}.{to_cols}`  *({source_tag}, confidence {conf}{seen})*"
        )
    return "\n".join(lines)
