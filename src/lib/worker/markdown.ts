/**
 * Markdown generation helpers with provenance tagging.
 *
 * Each "block" in a generated doc is wrapped in a comment so future regenerations
 * can preserve human-authored sections. See CLAUDE.md "Doc provenance".
 */
import type { SourceTable, ColumnProfile } from "./source-pg";

export type Provenance = "schema" | "query-log" | "claude" | "human";

export function provenanceWrap(kind: Provenance, body: string, meta?: string): string {
  const tag = meta
    ? `<!-- provenance: ${kind}, ${meta} -->`
    : `<!-- provenance: ${kind} -->`;
  return `${tag}\n${body.trim()}\n`;
}

/**
 * Strip all provenance blocks except those tagged `human`. Used by Loop 2 to
 * regenerate Claude-authored sections while preserving human edits.
 */
export function preserveHumanBlocks(markdown: string): string {
  const blocks = splitBlocks(markdown);
  return blocks
    .filter((b) => b.provenance === "human" || b.provenance === "schema")
    .map((b) => b.raw)
    .join("\n");
}

type Block = { provenance: Provenance | null; raw: string };

export function splitBlocks(markdown: string): Block[] {
  const lines = markdown.split("\n");
  const blocks: Block[] = [];
  let cur: string[] = [];
  let curProv: Provenance | null = null;

  const flush = () => {
    if (cur.length === 0) return;
    blocks.push({ provenance: curProv, raw: cur.join("\n") });
    cur = [];
    curProv = null;
  };

  for (const line of lines) {
    const m = line.match(/^<!--\s*provenance:\s*(schema|query-log|claude|human)/);
    if (m) {
      flush();
      curProv = m[1] as Provenance;
    }
    cur.push(line);
  }
  flush();
  return blocks;
}

export function countProvenance(markdown: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of splitBlocks(markdown)) {
    if (!b.provenance) continue;
    out[b.provenance] = (out[b.provenance] ?? 0) + 1;
  }
  return out;
}

export function renderStructuralDoc(
  table: SourceTable,
  profiles: Map<string, ColumnProfile>
): string {
  const parts: string[] = [];

  parts.push(`# ${table.schema_name}.${table.table_name}`);
  parts.push("");

  const summary = [
    `The \`${table.table_name}\` table has ${table.columns.length} column${table.columns.length === 1 ? "" : "s"} and ${formatCount(table.row_count)} row${table.row_count === 1 ? "" : "s"}.`,
  ];
  const fks = table.columns.filter((c) => c.fk_target);
  if (fks.length > 0) {
    summary.push(
      `It has foreign keys to ${fks
        .map((c) => `\`${c.fk_target}\` (via \`${c.column_name}\`)`)
        .join(", ")}.`
    );
  }
  parts.push(provenanceWrap("schema", summary.join(" ")));
  parts.push("");

  parts.push(provenanceWrap("schema", "## Columns\n\n" + renderColumnTable(table, profiles)));
  parts.push("");

  // Per-column profile blocks
  for (const c of table.columns) {
    const p = profiles.get(c.column_name);
    if (!p) continue;
    parts.push(renderColumnProfile(c.column_name, c.data_type, p));
    parts.push("");
  }

  return parts.join("\n");
}

function renderColumnTable(
  table: SourceTable,
  profiles: Map<string, ColumnProfile>
): string {
  const rows = ["| Column | Type | Null rate | Distinct | PK | FK |", "| --- | --- | --- | --- | --- | --- |"];
  for (const c of table.columns) {
    const p = profiles.get(c.column_name);
    rows.push(
      `| \`${c.column_name}\` | ${c.data_type} | ${p ? (p.null_rate * 100).toFixed(1) + "%" : "—"} | ${p ? p.distinct_count : "—"} | ${c.is_primary ? "✓" : ""} | ${c.fk_target ?? ""} |`
    );
  }
  return rows.join("\n");
}

function renderColumnProfile(name: string, type: string, p: ColumnProfile): string {
  const lines: string[] = [];
  lines.push(`### \`${name}\` (${type})`);
  lines.push("");
  lines.push(`- Null rate: ${(p.null_rate * 100).toFixed(1)}%`);
  lines.push(`- Distinct values: ${p.distinct_count}`);
  if (p.min_value !== null) lines.push(`- Min: \`${truncate(p.min_value)}\``);
  if (p.max_value !== null) lines.push(`- Max: \`${truncate(p.max_value)}\``);
  if (p.top_values.length > 0) {
    lines.push(`- Top values:`);
    for (const tv of p.top_values) {
      lines.push(`  - \`${truncate(tv.value)}\` (${tv.count})`);
    }
  }
  if (p.histogram && p.histogram.length > 0) {
    lines.push(`- Histogram (10 bins): ${p.histogram.map((h) => `${h.bin}:${h.count}`).join(", ")}`);
  }
  if (p.sample_values.length > 0) {
    lines.push(`- Sample values: ${p.sample_values.map((s) => `\`${truncate(s)}\``).join(", ")}`);
  }
  return provenanceWrap("schema", lines.join("\n"));
}

function truncate(s: string, n = 60): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + "k";
  return (n / 1_000_000).toFixed(1) + "M";
}
