/**
 * Read queries for the catalog DB. These power both the UI panel and the
 * agent's tool calls (list_tables, describe_table). All raw SQL because we
 * dropped Drizzle for v0.1.
 */
import { catalogPool } from "./db";
import type {
  SourceRow,
  TableRow,
  ColumnRow,
  ColumnProfileRow,
  DocRow,
  AuditRow,
} from "./schema";

export type TableWithCounts = TableRow & {
  source_name: string;
  column_count: number;
};

export async function listSources(): Promise<SourceRow[]> {
  const r = await catalogPool.query<SourceRow>(
    `SELECT id, name, kind, conn_url, created_at FROM sources ORDER BY id`,
  );
  return r.rows;
}

export async function listTables(): Promise<TableWithCounts[]> {
  const r = await catalogPool.query<TableWithCounts>(
    `SELECT t.id, t.source_id, t.schema_name, t.table_name, t.row_count,
            t.status, t.last_profiled_at, t.last_enriched_at,
            s.name AS source_name,
            (SELECT count(*)::int FROM columns c WHERE c.table_id = t.id) AS column_count
       FROM tables t
       JOIN sources s ON s.id = t.source_id
       ORDER BY t.source_id, t.table_name`,
  );
  return r.rows;
}

export async function getTable(tableId: number): Promise<TableRow | null> {
  const r = await catalogPool.query<TableRow>(
    `SELECT id, source_id, schema_name, table_name, row_count, status,
            last_profiled_at, last_enriched_at
       FROM tables WHERE id = $1`,
    [tableId],
  );
  return r.rows[0] ?? null;
}

export async function getTableByName(
  sourceName: string,
  tableName: string,
): Promise<TableRow | null> {
  const r = await catalogPool.query<TableRow>(
    `SELECT t.id, t.source_id, t.schema_name, t.table_name, t.row_count,
            t.status, t.last_profiled_at, t.last_enriched_at
       FROM tables t
       JOIN sources s ON s.id = t.source_id
       WHERE s.name = $1 AND t.table_name = $2`,
    [sourceName, tableName],
  );
  return r.rows[0] ?? null;
}

export async function listColumns(tableId: number): Promise<ColumnRow[]> {
  const r = await catalogPool.query<ColumnRow>(
    `SELECT id, table_id, column_name, ordinal, data_type, is_nullable,
            is_primary, fk_target
       FROM columns WHERE table_id = $1 ORDER BY ordinal`,
    [tableId],
  );
  return r.rows;
}

export async function getProfilesForTable(
  tableId: number,
): Promise<Map<number, ColumnProfileRow>> {
  const r = await catalogPool.query<ColumnProfileRow>(
    `SELECT p.id, p.column_id, p.null_rate, p.distinct_count, p.min_value,
            p.max_value, p.top_values, p.histogram, p.sample_values, p.profiled_at
       FROM column_profiles p
       JOIN columns c ON c.id = p.column_id
      WHERE c.table_id = $1`,
    [tableId],
  );
  const m = new Map<number, ColumnProfileRow>();
  for (const row of r.rows) m.set(row.column_id, row);
  return m;
}

export async function getDoc(tableId: number): Promise<DocRow | null> {
  const r = await catalogPool.query<DocRow>(
    `SELECT id, table_id, path, markdown, provenance, updated_at
       FROM docs WHERE table_id = $1`,
    [tableId],
  );
  return r.rows[0] ?? null;
}

export async function recentAudit(limit = 50): Promise<AuditRow[]> {
  const r = await catalogPool.query<AuditRow>(
    `SELECT id, ts, actor, action, target, details
       FROM audit_log ORDER BY ts DESC LIMIT $1`,
    [limit],
  );
  return r.rows;
}

export async function audit(
  actor: string,
  action: string,
  target: string | null = null,
  details?: unknown,
): Promise<void> {
  await catalogPool.query(
    `INSERT INTO audit_log (actor, action, target, details) VALUES ($1, $2, $3, $4::jsonb)`,
    [actor, action, target, details ? JSON.stringify(details) : null],
  );
}
