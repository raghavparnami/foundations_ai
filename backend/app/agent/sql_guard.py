"""SELECT-only SQL guard.

Parses with sqlglot (PostgreSQL dialect) and enforces:
  - exactly one statement
  - top-level is SELECT (or a CTE chain ending in SELECT)
  - no DML/DDL statements anywhere in the tree

Raises UnsafeSqlError on any violation. Returns the trimmed SQL on success.
"""
from __future__ import annotations

import sqlglot
from sqlglot import exp


class UnsafeSqlError(Exception):
    """SQL was either unparseable or not a pure SELECT."""


_FORBIDDEN: tuple[type[exp.Expression], ...] = (
    exp.Insert,
    exp.Update,
    exp.Delete,
    exp.Merge,
    exp.Create,
    exp.Drop,
    exp.Alter,
    exp.TruncateTable,
)


def assert_select_only(sql: str) -> str:
    trimmed = sql.strip().rstrip(";").strip()
    if not trimmed:
        raise UnsafeSqlError("Empty SQL")

    try:
        statements = sqlglot.parse(trimmed, read="postgres")
    except Exception as e:  # noqa: BLE001
        raise UnsafeSqlError(f"SQL parse error: {e}") from e

    if len(statements) != 1:
        raise UnsafeSqlError(f"Expected exactly one statement, got {len(statements)}")

    stmt = statements[0]
    if stmt is None:
        raise UnsafeSqlError("Empty parse tree")

    # Top-level must be SELECT (or a Subquery / CTE wrapper whose body is SELECT).
    if not isinstance(stmt, (exp.Select, exp.Union, exp.Subquery, exp.With)):
        raise UnsafeSqlError(f"Only SELECT statements are allowed (got {type(stmt).__name__})")

    # Defense in depth — reject any DML/DDL node anywhere in the tree.
    for node in stmt.walk():
        # walk() yields tuples in older sqlglot, plain nodes in newer — normalize.
        target = node[0] if isinstance(node, tuple) else node
        if isinstance(target, _FORBIDDEN):
            raise UnsafeSqlError(f"{type(target).__name__} not allowed inside SQL")

    return trimmed
