/**
 * TypeScript row shapes for the catalog tables. Hand-maintained to match
 * push.ts DDL. We're not using Drizzle in v0.1 (raw SQL via pg.Pool); these
 * types just give callers in queries.ts and the API routes a structure to
 * destructure against.
 */

export type SourceRow = {
  id: number;
  name: string;
  kind: string;
  conn_url: string;
  created_at: string;
};

export type TableStatus = "pending" | "profiling" | "profiled" | "enriching" | "ready";

export type TableRow = {
  id: number;
  source_id: number;
  schema_name: string;
  table_name: string;
  row_count: number | null;
  status: TableStatus;
  last_profiled_at: string | null;
  last_enriched_at: string | null;
};

export type ColumnRow = {
  id: number;
  table_id: number;
  column_name: string;
  ordinal: number;
  data_type: string;
  is_nullable: boolean;
  is_primary: boolean;
  fk_target: string | null;
};

export type ColumnProfileRow = {
  id: number;
  column_id: number;
  null_rate: number | null;
  distinct_count: number | null;
  min_value: string | null;
  max_value: string | null;
  top_values: Array<{ value: string; count: number }> | null;
  histogram: Array<{ bin: string; count: number }> | null;
  sample_values: string[] | null;
  profiled_at: string;
};

export type DocRow = {
  id: number;
  table_id: number;
  path: string;
  markdown: string;
  provenance: Record<string, number>;
  updated_at: string;
};

export type ProposalRow = {
  id: number;
  kind: "view" | "metric";
  name: string;
  description: string | null;
  sql: string;
  status: "applied" | "pending" | "rejected";
  created_at: string;
};

export type AuditRow = {
  id: number;
  ts: string;
  actor: string;
  action: string;
  target: string | null;
  details: unknown;
};
