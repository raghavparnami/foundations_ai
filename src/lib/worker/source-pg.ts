/**
 * Postgres "source" connector. Reads schema + samples from a user-connected
 * Postgres database. This is the v0.1 MCP-postgres stand-in; later it moves
 * into its own MCP server.
 */
import { Pool } from "pg";

export type SourceColumn = {
  column_name: string;
  ordinal: number;
  data_type: string;
  is_nullable: boolean;
  is_primary: boolean;
  fk_target: string | null;
};

export type SourceTable = {
  schema_name: string;
  table_name: string;
  columns: SourceColumn[];
  row_count: number;
};

// sourcePool moved to `../catalog/db.ts` so both worker and chat agent share
// the same pool cache (keyed by connection URL).

export async function listTables(pool: Pool, schema = "public"): Promise<SourceTable[]> {
  const tableRows = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = $1 AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
    [schema]
  );

  const tables: SourceTable[] = [];
  for (const t of tableRows.rows) {
    const cols = await pool.query<{
      column_name: string;
      ordinal_position: number;
      data_type: string;
      is_nullable: string;
    }>(
      `SELECT column_name, ordinal_position, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       ORDER BY ordinal_position`,
      [schema, t.table_name]
    );

    const pkRows = await pool.query<{ column_name: string }>(
      `SELECT a.attname AS column_name
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = ($1::regclass) AND i.indisprimary`,
      [`${schema}.${t.table_name}`]
    );
    const pkSet = new Set(pkRows.rows.map((r) => r.column_name));

    const fkRows = await pool.query<{
      column_name: string;
      ref_schema: string;
      ref_table: string;
      ref_column: string;
    }>(
      `SELECT
         kcu.column_name,
         ccu.table_schema AS ref_schema,
         ccu.table_name   AS ref_table,
         ccu.column_name  AS ref_column
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_schema = $1 AND tc.table_name = $2`,
      [schema, t.table_name]
    );
    const fkMap = new Map(
      fkRows.rows.map((r) => [
        r.column_name,
        `${r.ref_schema}.${r.ref_table}.${r.ref_column}`,
      ])
    );

    const rc = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM "${schema}"."${t.table_name}"`
    );

    tables.push({
      schema_name: schema,
      table_name: t.table_name,
      row_count: Number(rc.rows[0]?.n ?? 0),
      columns: cols.rows.map((c) => ({
        column_name: c.column_name,
        ordinal: c.ordinal_position,
        data_type: c.data_type,
        is_nullable: c.is_nullable === "YES",
        is_primary: pkSet.has(c.column_name),
        fk_target: fkMap.get(c.column_name) ?? null,
      })),
    });
  }
  return tables;
}

const NUMERIC_TYPES = new Set([
  "smallint", "integer", "bigint", "decimal", "numeric", "real",
  "double precision", "serial", "bigserial",
]);

// Postgres types that support min/max (not boolean, not arrays, not json).
const COMPARABLE_TYPES = new Set([
  "smallint", "integer", "bigint", "decimal", "numeric", "real", "double precision",
  "serial", "bigserial",
  "text", "character varying", "character", "varchar", "char", "name", "citext",
  "date", "time", "time without time zone", "time with time zone",
  "timestamp", "timestamp without time zone", "timestamp with time zone",
  "uuid", "inet", "cidr",
]);

export type ColumnProfile = {
  null_rate: number;
  distinct_count: number;
  min_value: string | null;
  max_value: string | null;
  top_values: { value: string; count: number }[];
  histogram: { bin: string; count: number }[] | null;
  sample_values: string[];
};

export async function profileColumn(
  pool: Pool,
  schema: string,
  table: string,
  column: string,
  dataType: string,
  rowCount: number
): Promise<ColumnProfile> {
  const qid = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const T = `${qid(schema)}.${qid(table)}`;
  const C = qid(column);

  // null rate + distinct count — always works.
  const counts = await pool.query<{ null_rate: string; distinct: string }>(
    `SELECT
       COALESCE((count(*) FILTER (WHERE ${C} IS NULL))::float / NULLIF(count(*),0), 0) AS null_rate,
       count(DISTINCT ${C}::text)::text AS distinct
     FROM ${T}`
  );
  const null_rate = Number(counts.rows[0]?.null_rate ?? 0);
  const distinct_count = Number(counts.rows[0]?.distinct ?? 0);

  // min/max — only for types that support comparison
  let min_value: string | null = null;
  let max_value: string | null = null;
  if (COMPARABLE_TYPES.has(dataType)) {
    try {
      const mm = await pool.query<{ min_val: string | null; max_val: string | null }>(
        `SELECT min(${C})::text AS min_val, max(${C})::text AS max_val FROM ${T}`
      );
      min_value = mm.rows[0]?.min_val ?? null;
      max_value = mm.rows[0]?.max_val ?? null;
    } catch {
      // ignore — leave nulls
    }
  }

  // Top-5 frequent values — cast everything to text for uniform handling
  let top_values: { value: string; count: number }[] = [];
  try {
    const topQ = await pool.query<{ value: string; count: string }>(
      `SELECT ${C}::text AS value, count(*)::text AS count
       FROM ${T}
       WHERE ${C} IS NOT NULL
       GROUP BY ${C}::text
       ORDER BY count(*) DESC
       LIMIT 5`
    );
    top_values = topQ.rows.map((r) => ({ value: r.value, count: Number(r.count) }));
  } catch { /* ignore */ }

  // Sample values — order by the cast text, which works for any type
  let sample_values: string[] = [];
  try {
    const samplesQ = await pool.query<{ v: string }>(
      `SELECT DISTINCT ${C}::text AS v FROM ${T}
       WHERE ${C} IS NOT NULL
       ORDER BY v LIMIT 5`
    );
    sample_values = samplesQ.rows.map((r) => r.v);
  } catch { /* ignore */ }

  // Histogram — numeric types only
  let histogram: { bin: string; count: number }[] | null = null;
  if (NUMERIC_TYPES.has(dataType) && rowCount > 0) {
    try {
      const histQ = await pool.query<{ bucket: string; count: string }>(
        `WITH bounds AS (
           SELECT min(${C})::float8 AS lo, max(${C})::float8 AS hi FROM ${T}
         )
         SELECT
           width_bucket(${C}::float8, b.lo, b.hi + 1e-9, 10)::text AS bucket,
           count(*)::text AS count
         FROM ${T}, bounds b
         WHERE ${C} IS NOT NULL
         GROUP BY 1 ORDER BY 1`
      );
      histogram = histQ.rows.map((r) => ({ bin: r.bucket, count: Number(r.count) }));
    } catch { /* ignore */ }
  }

  return { null_rate, distinct_count, min_value, max_value, top_values, histogram, sample_values };
}

export async function sampleRows(
  pool: Pool,
  schema: string,
  table: string,
  limit = 5
): Promise<Record<string, unknown>[]> {
  const r = await pool.query(`SELECT * FROM "${schema}"."${table}" LIMIT $1`, [limit]);
  return r.rows;
}
