#!/usr/bin/env node
/**
 * loom-mcp-postgres — an MCP server that exposes any Postgres database as a
 * set of read-only tools for LLM agents. Designed to be dropped into Claude
 * Code, Claude Desktop, or any MCP-compatible client.
 *
 * Configure with one env var:
 *   LOOM_SOURCE_URL=postgres://user:pass@host:5432/db
 *
 * Optional:
 *   LOOM_SCHEMA=public            (default schema for list_tables)
 *   LOOM_SQL_ROW_LIMIT=200        (hard cap on rows returned from run_sql)
 *
 * Transport: stdio (default for MCP servers).
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Pool } from "pg";
import { z } from "zod";
import { assertSelectOnly, UnsafeSqlError } from "./sql-guard.js";

const SOURCE_URL = process.env.LOOM_SOURCE_URL;
if (!SOURCE_URL) {
  console.error(
    "loom-mcp-postgres: set LOOM_SOURCE_URL=postgres://user:pass@host:5432/db",
  );
  process.exit(2);
}
const DEFAULT_SCHEMA = process.env.LOOM_SCHEMA ?? "public";
const ROW_LIMIT = Number(process.env.LOOM_SQL_ROW_LIMIT ?? 200);

const pool = new Pool({ connectionString: SOURCE_URL, max: 4 });

const TOOLS = [
  {
    name: "list_tables",
    description:
      "List tables in the connected Postgres schema with column counts and row estimates.",
    inputSchema: {
      type: "object",
      properties: {
        schema: { type: "string", description: `Schema to list (default: ${DEFAULT_SCHEMA})` },
      },
    },
  },
  {
    name: "describe_table",
    description:
      "Return columns, types, nullability, primary key, and foreign keys for a table.",
    inputSchema: {
      type: "object",
      properties: {
        table_name: { type: "string" },
        schema: { type: "string" },
      },
      required: ["table_name"],
    },
  },
  {
    name: "sample_rows",
    description: "Return up to N sample rows from a table (default 5, max 25).",
    inputSchema: {
      type: "object",
      properties: {
        table_name: { type: "string" },
        schema: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 25 },
      },
      required: ["table_name"],
    },
  },
  {
    name: "run_sql",
    description:
      "Run a read-only SELECT (or WITH ... SELECT) against the database. Anything that mutates is rejected by an AST guard.",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "A single SELECT statement." },
      },
      required: ["sql"],
    },
  },
];

const server = new Server(
  { name: "loom-mcp-postgres", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;
  try {
    let payload: unknown;
    if (name === "list_tables") payload = await listTables(z.object({ schema: z.string().optional() }).parse(args));
    else if (name === "describe_table") payload = await describeTable(z.object({ table_name: z.string(), schema: z.string().optional() }).parse(args));
    else if (name === "sample_rows") payload = await sampleRows(z.object({ table_name: z.string(), schema: z.string().optional(), limit: z.number().int().min(1).max(25).optional() }).parse(args));
    else if (name === "run_sql") payload = await runSql(z.object({ sql: z.string() }).parse(args));
    else throw new Error(`Unknown tool: ${name}`);
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  } catch (e) {
    const msg = e instanceof UnsafeSqlError ? `Rejected by SQL guard: ${e.message}` : (e as Error).message;
    return { content: [{ type: "text", text: JSON.stringify({ error: msg }) }], isError: true };
  }
});

async function listTables(opts: { schema?: string }) {
  const schema = opts.schema ?? DEFAULT_SCHEMA;
  const r = await pool.query<{ table_name: string; n_live_tup: string | null; column_count: string }>(
    `SELECT t.table_name,
            (SELECT COALESCE(reltuples,0)::text FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = t.table_schema AND c.relname = t.table_name) AS n_live_tup,
            (SELECT count(*)::text FROM information_schema.columns c
              WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name) AS column_count
       FROM information_schema.tables t
      WHERE t.table_schema = $1 AND t.table_type IN ('BASE TABLE','VIEW')
      ORDER BY t.table_name`,
    [schema],
  );
  return {
    schema,
    tables: r.rows.map((row) => ({
      name: row.table_name,
      column_count: Number(row.column_count),
      approx_row_count: Math.max(0, Math.floor(Number(row.n_live_tup ?? 0))),
    })),
  };
}

async function describeTable(opts: { table_name: string; schema?: string }) {
  const schema = opts.schema ?? DEFAULT_SCHEMA;
  const cols = await pool.query<{ column_name: string; ordinal: number; data_type: string; is_nullable: string }>(
    `SELECT column_name, ordinal_position AS ordinal, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position`,
    [schema, opts.table_name],
  );
  if (cols.rows.length === 0) return { error: `No table named "${opts.table_name}" in schema "${schema}".` };
  const pks = await pool.query<{ column_name: string }>(
    `SELECT a.attname AS column_name
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = ($1::regclass) AND i.indisprimary`,
    [`${schema}.${opts.table_name}`],
  );
  const pkSet = new Set(pks.rows.map((r) => r.column_name));
  const fks = await pool.query<{ column_name: string; ref_schema: string; ref_table: string; ref_column: string }>(
    `SELECT kcu.column_name, ccu.table_schema AS ref_schema, ccu.table_name AS ref_table, ccu.column_name AS ref_column
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1 AND tc.table_name = $2`,
    [schema, opts.table_name],
  );
  const fkMap = new Map(fks.rows.map((r) => [r.column_name, `${r.ref_schema}.${r.ref_table}.${r.ref_column}`]));
  return {
    schema,
    name: opts.table_name,
    columns: cols.rows.map((c) => ({
      name: c.column_name,
      ordinal: c.ordinal,
      data_type: c.data_type,
      nullable: c.is_nullable === "YES",
      is_primary: pkSet.has(c.column_name),
      fk_target: fkMap.get(c.column_name) ?? null,
    })),
  };
}

async function sampleRows(opts: { table_name: string; schema?: string; limit?: number }) {
  const schema = opts.schema ?? DEFAULT_SCHEMA;
  const n = Math.min(25, Math.max(1, opts.limit ?? 5));
  const r = await pool.query(`SELECT * FROM "${schema}"."${opts.table_name}" LIMIT $1`, [n]);
  return { rows: r.rows.map(coerce), row_count: r.rowCount ?? 0 };
}

async function runSql(opts: { sql: string }) {
  const cleaned = assertSelectOnly(opts.sql);
  const r = await pool.query(cleaned);
  return {
    columns: r.fields.map((f) => f.name),
    rows: r.rows.slice(0, ROW_LIMIT).map(coerce),
    row_count: r.rowCount ?? r.rows.length,
    truncated: r.rows.length > ROW_LIMIT,
  };
}

function coerce(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Date) out[k] = v.toISOString();
    else if (typeof v === "bigint") out[k] = v.toString();
    else out[k] = v;
  }
  return out;
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`loom-mcp-postgres connected · source=${redact(SOURCE_URL!)} · schema=${DEFAULT_SCHEMA}`);
}

function redact(url: string): string {
  return url.replace(/(:\/\/[^:]+:)([^@]+)(@)/, "$1•••$3");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
