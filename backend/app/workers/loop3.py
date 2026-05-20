"""Loop 3 — relationship discovery.

Two passes per tick: (A) mine observed joins from `audit_log` SQL by parsing
JOIN ... ON clauses with sqlglot, then upsert as 'observed' edges; (B) find
identifier-shaped columns that appear across 2+ tables without a declared FK
and insert as low-confidence 'name_match' candidates. The FK backfill (highest
confidence) is the one-shot `backfill_fk_joins()` called at boot.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any

from ..audit import audit
from ..catalog.joins import backfill_fk_joins, upsert_join
from ..db import get_conn

log = logging.getLogger(__name__)

OBSERVED_LOOKBACK = "interval '24 hours'"
NAME_MATCH_LIMIT = 80


@dataclass(slots=True)
class JoinHit:
    from_table: str
    from_col: str
    to_table: str
    to_col: str


async def run_loop3() -> dict[str, int]:
    """Run all three discovery passes. Safe to call from the scheduler."""
    t0 = time.monotonic()
    fk_inserted = await backfill_fk_joins()
    observed = await _mine_observed_joins()
    names = await _mine_name_matches()
    ms = int((time.monotonic() - t0) * 1000)
    if fk_inserted + observed + names > 0:
        await audit(
            "worker:loop3",
            "discovery",
            None,
            {
                "fk_seeded": fk_inserted,
                "observed_pairs": observed,
                "name_match_pairs": names,
                "ms": ms,
            },
        )
    log.info(
        "loop3.done fk_seeded=%s observed_pairs=%s name_match_pairs=%s ms=%s",
        fk_inserted,
        observed,
        names,
        ms,
    )
    return {
        "fk_seeded": fk_inserted,
        "observed_pairs": observed,
        "name_match_pairs": names,
    }


# ─── Pass A: observed joins ──────────────────────────────────────────────


async def _mine_observed_joins() -> int:
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                f"""
                SELECT (details->>'sql') AS sql
                  FROM audit_log
                 WHERE actor = 'agent' AND action = 'tool:run_sql'
                   AND ts > NOW() - {OBSERVED_LOOKBACK}
                   AND (details->>'sql') ILIKE %s
                 ORDER BY ts DESC LIMIT 200
                """,
                ("%join%",),
            )
            sql_rows = await cur.fetchall()

        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT id, schema_name, table_name FROM tables"
            )
            table_rows = await cur.fetchall()

    by_qualified: dict[str, int] = {}
    by_bare: dict[str, list[int]] = {}
    for tid, schema_name, table_name in table_rows:
        by_qualified[f"{schema_name}.{table_name}"] = int(tid)
        # Also map bare table name so unqualified SQL still resolves.
        by_qualified.setdefault(table_name, int(tid))
        by_bare.setdefault(table_name, []).append(int(tid))

    pairs = 0
    for (sql_text,) in sql_rows:
        if not sql_text:
            continue
        hits = _extract_join_hits(sql_text, by_qualified)
        for h in hits:
            from_id = by_qualified.get(h.from_table)
            to_id = by_qualified.get(h.to_table)
            if not from_id or not to_id or from_id == to_id:
                continue
            try:
                await upsert_join(
                    from_table_id=from_id,
                    to_table_id=to_id,
                    from_columns=[h.from_col],
                    to_columns=[h.to_col],
                    source="observed",
                    confidence=0.7,
                )
                await upsert_join(
                    from_table_id=to_id,
                    to_table_id=from_id,
                    from_columns=[h.to_col],
                    to_columns=[h.from_col],
                    source="observed",
                    confidence=0.7,
                )
                pairs += 1
            except Exception:  # noqa: BLE001
                # Next tick will retry; never let one upsert tank the loop.
                continue
    return pairs


def _extract_join_hits(sql: str, by_qualified: dict[str, int]) -> list[JoinHit]:
    """Parse SQL with sqlglot and return every JOIN ... ON a.col = b.col pair.

    Only emits a hit when BOTH sides resolve to known tables (qualified or bare).
    """
    try:
        import sqlglot
        from sqlglot import exp
    except Exception:  # noqa: BLE001
        return []

    cleaned = sql.strip().rstrip(";").strip()
    try:
        tree = sqlglot.parse_one(cleaned, read="postgres")
    except Exception:  # noqa: BLE001
        return []
    if tree is None:
        return []

    # Build alias → real table name map across the whole tree.
    alias_to_table: dict[str, str] = {}
    for table in tree.find_all(exp.Table):
        name = table.name
        if not name:
            continue
        alias = table.alias_or_name
        if alias:
            alias_to_table[alias] = name
        alias_to_table.setdefault(name, name)

    out: list[JoinHit] = []
    for join in tree.find_all(exp.Join):
        on_expr = join.args.get("on")
        if on_expr is None:
            continue
        _collect_equi_joins(on_expr, alias_to_table, by_qualified, out)
    return out


def _collect_equi_joins(
    expr: Any,
    alias_to_table: dict[str, str],
    by_qualified: dict[str, int],
    out: list[JoinHit],
) -> None:
    from sqlglot import exp

    if isinstance(expr, (exp.And, exp.Or)):
        _collect_equi_joins(expr.this, alias_to_table, by_qualified, out)
        _collect_equi_joins(expr.expression, alias_to_table, by_qualified, out)
        return
    if isinstance(expr, exp.EQ):
        left = _read_column_ref(expr.this, alias_to_table)
        right = _read_column_ref(expr.expression, alias_to_table)
        if not left or not right or left[0] == right[0]:
            return
        if left[0] not in by_qualified or right[0] not in by_qualified:
            return
        out.append(
            JoinHit(from_table=left[0], from_col=left[1], to_table=right[0], to_col=right[1])
        )


def _read_column_ref(
    expr: Any, alias_to_table: dict[str, str]
) -> tuple[str, str] | None:
    from sqlglot import exp

    if not isinstance(expr, exp.Column):
        return None
    col_name = expr.name
    table_raw = expr.table  # alias or table name string ("" if unqualified)
    if not col_name or not table_raw:
        return None
    table = alias_to_table.get(table_raw, table_raw)
    return (table, col_name)


# ─── Pass B: name match candidates ───────────────────────────────────────


async def _mine_name_matches() -> int:
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                WITH ident_cols AS (
                  SELECT column_name, table_id
                    FROM columns
                   WHERE (column_name ~* '(_id|_key|_uuid)$'
                          OR column_name IN ('id','key','uuid'))
                     AND fk_target IS NULL
                )
                SELECT column_name, array_agg(DISTINCT table_id) AS table_ids
                  FROM ident_cols
                 GROUP BY column_name
                HAVING count(DISTINCT table_id) >= 2
                 ORDER BY count(DISTINCT table_id) DESC
                 LIMIT %s
                """,
                (NAME_MATCH_LIMIT,),
            )
            rows = await cur.fetchall()

    pairs = 0
    for column_name, table_ids in rows:
        ids = [int(x) for x in (table_ids or [])]
        for i, from_id in enumerate(ids):
            for j, to_id in enumerate(ids):
                if i == j:
                    continue
                try:
                    await upsert_join(
                        from_table_id=from_id,
                        to_table_id=to_id,
                        from_columns=[column_name],
                        to_columns=[column_name],
                        source="name_match",
                        confidence=0.5,
                        notes=(
                            f'Inferred from shared column name "{column_name}". '
                            "No FK declared."
                        ),
                    )
                    pairs += 1
                except Exception:  # noqa: BLE001
                    continue
    return pairs
