"""Provenance-tagged markdown writer.

Direct port of src/lib/worker/markdown.ts. Each block in a generated doc is
wrapped in `<!-- provenance: ... -->` so future regenerations can preserve
human-authored sections. See CLAUDE.md "Doc provenance".
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from .source_pg import ColumnProfile, SourceTable

Provenance = Literal["schema", "query-log", "claude", "human"]
_PROV_RE = re.compile(r"^<!--\s*provenance:\s*(schema|query-log|claude|human)")


def provenance_wrap(kind: Provenance, body: str, meta: str | None = None) -> str:
    tag = f"<!-- provenance: {kind}, {meta} -->" if meta else f"<!-- provenance: {kind} -->"
    return f"{tag}\n{body.strip()}\n"


@dataclass(slots=True)
class _Block:
    provenance: Provenance | None
    raw: str


def _split_blocks(markdown: str) -> list[_Block]:
    lines = markdown.split("\n")
    blocks: list[_Block] = []
    cur: list[str] = []
    cur_prov: Provenance | None = None

    def flush() -> None:
        nonlocal cur, cur_prov
        if cur:
            blocks.append(_Block(provenance=cur_prov, raw="\n".join(cur)))
            cur = []
            cur_prov = None

    for line in lines:
        m = _PROV_RE.match(line)
        if m:
            flush()
            cur_prov = m.group(1)  # type: ignore[assignment]
        cur.append(line)
    flush()
    return blocks


def preserve_human_blocks(markdown: str) -> str:
    """Strip non-human, non-schema blocks. Used by Loop 2 to regenerate
    Claude-authored sections while preserving the structural half + edits.
    """
    keep = [b.raw for b in _split_blocks(markdown) if b.provenance in ("human", "schema")]
    return "\n".join(keep)


def count_provenance(markdown: str) -> dict[str, int]:
    out: dict[str, int] = {}
    for b in _split_blocks(markdown):
        if b.provenance is None:
            continue
        out[b.provenance] = out.get(b.provenance, 0) + 1
    return out


def render_structural_doc(table: SourceTable, profiles: dict[str, ColumnProfile]) -> str:
    parts: list[str] = []
    parts.append(f"# {table.schema_name}.{table.table_name}")
    parts.append("")

    cols = len(table.columns)
    rc = _format_count(table.row_count)
    summary = [
        f"The `{table.table_name}` table has {cols} column{'' if cols == 1 else 's'} "
        f"and {rc} row{'' if table.row_count == 1 else 's'}."
    ]
    fks = [c for c in table.columns if c.fk_target]
    if fks:
        summary.append(
            "It has foreign keys to "
            + ", ".join(f"`{c.fk_target}` (via `{c.column_name}`)" for c in fks)
            + "."
        )
    parts.append(provenance_wrap("schema", " ".join(summary)))
    parts.append("")

    parts.append(provenance_wrap("schema", "## Columns\n\n" + _render_column_table(table, profiles)))
    parts.append("")

    for c in table.columns:
        p = profiles.get(c.column_name)
        if p is None:
            continue
        parts.append(_render_column_profile(c.column_name, c.data_type, p))
        parts.append("")

    return "\n".join(parts)


def _render_column_table(table: SourceTable, profiles: dict[str, ColumnProfile]) -> str:
    rows = [
        "| Column | Type | Null rate | Distinct | PK | FK |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for c in table.columns:
        p = profiles.get(c.column_name)
        null_rate = f"{(p.null_rate * 100):.1f}%" if p else "—"
        distinct = str(p.distinct_count) if p else "—"
        pk = "✓" if c.is_primary else ""
        fk = c.fk_target or ""
        rows.append(f"| `{c.column_name}` | {c.data_type} | {null_rate} | {distinct} | {pk} | {fk} |")
    return "\n".join(rows)


def _render_column_profile(name: str, type_: str, p: ColumnProfile) -> str:
    lines: list[str] = []
    lines.append(f"### `{name}` ({type_})")
    lines.append("")
    lines.append(f"- Null rate: {(p.null_rate * 100):.1f}%")
    lines.append(f"- Distinct values: {p.distinct_count}")
    if p.min_value is not None:
        lines.append(f"- Min: `{_truncate(p.min_value)}`")
    if p.max_value is not None:
        lines.append(f"- Max: `{_truncate(p.max_value)}`")
    if p.top_values:
        lines.append("- Top values:")
        for tv in p.top_values:
            lines.append(f"  - `{_truncate(tv.value)}` ({tv.count})")
    if p.histogram:
        lines.append(
            "- Histogram (10 bins): "
            + ", ".join(f"{h.bin}:{h.count}" for h in p.histogram)
        )
    if p.sample_values:
        lines.append(
            "- Sample values: "
            + ", ".join(f"`{_truncate(s)}`" for s in p.sample_values)
        )
    return provenance_wrap("schema", "\n".join(lines))


def _truncate(s: str, n: int = 60) -> str:
    return s if len(s) <= n else s[: n - 1] + "…"


def _format_count(n: int) -> str:
    if n < 1000:
        return str(n)
    if n < 1_000_000:
        return f"{n / 1000:.1f}k" if n < 10_000 else f"{n / 1000:.0f}k"
    return f"{n / 1_000_000:.1f}M"
