/**
 * Loop 3 — relationship discovery.
 *
 * Two passes per tick:
 *
 *   A. Observed joins from audit_log.
 *      Parse every recent `tool:run_sql` SQL via node-sql-parser; extract
 *      JOIN ... ON a.col = b.col pairs; resolve names to table_ids; upsert
 *      into `joins` with source='observed', confidence growing with how
 *      often the pair recurs.
 *
 *   B. Name-match candidates.
 *      Find shared identifier-shaped columns (`*_id`, `*_key`, `*_uuid`)
 *      that appear in 2+ tables without a declared FK. Insert as low-
 *      confidence (0.5) 'name_match' candidates — the agent treats these
 *      as hints, not authoritative.
 *
 * The FK backfill (highest confidence, 1.0) is a one-shot called at boot
 * via backfillFkJoins() — that runs in joins.ts.
 */
import { Parser } from "node-sql-parser";
import { catalogPool } from "../catalog/db";
import { upsertJoin, backfillFkJoins } from "../catalog/joins";
import { audit } from "../catalog/queries";
import { log } from "../shared/log";

const sqlParser = new Parser();

declare global {
  var __loomLoop3LastRunAt: number | undefined;
}

const OBSERVED_LOOKBACK = "interval '24 hours'";
const NAME_MATCH_LIMIT = 80;

/** Run all three discovery passes. Safe to call from the scheduler. */
export async function runLoop3(): Promise<{
  fk_seeded: number;
  observed_pairs: number;
  name_match_pairs: number;
}> {
  const t0 = Date.now();
  const fk = await backfillFkJoins();
  const observed = await mineObservedJoins();
  const names = await mineNameMatches();
  const ms = Date.now() - t0;
  if (fk.inserted + observed + names > 0) {
    await audit("worker:loop3", "discovery", null, {
      fk_seeded: fk.inserted,
      observed_pairs: observed,
      name_match_pairs: names,
      ms,
    });
  }
  log.info("loop3.done", { fk_seeded: fk.inserted, observed_pairs: observed, name_match_pairs: names, ms });
  return { fk_seeded: fk.inserted, observed_pairs: observed, name_match_pairs: names };
}

// ─── Pass A: observed ─────────────────────────────────────────────────────

type JoinHit = { from: string; fromCol: string; to: string; toCol: string };

async function mineObservedJoins(): Promise<number> {
  const rows = await catalogPool.query<{ sql: string }>(
    `SELECT (details->>'sql') AS sql
       FROM audit_log
      WHERE actor = 'agent' AND action = 'tool:run_sql'
        AND ts > NOW() - ${OBSERVED_LOOKBACK}
        AND (details->>'sql') ILIKE '%join%'
      ORDER BY ts DESC LIMIT 200`,
  );

  // Build a name → table_id map (qualified + bare for resilience).
  const tableRows = await catalogPool.query<{ id: number; schema_name: string; table_name: string }>(
    `SELECT id, schema_name, table_name FROM tables`,
  );
  const byQualified = new Map<string, number>();
  const byBare = new Map<string, number[]>();
  for (const t of tableRows.rows) {
    byQualified.set(`${t.schema_name}.${t.table_name}`, t.id);
    byQualified.set(t.table_name, t.id);  // also allow alias-as-table-name
    const arr = byBare.get(t.table_name) ?? [];
    arr.push(t.id);
    byBare.set(t.table_name, arr);
  }

  // Track alias → real table for each query so we can resolve `d.run_id`.
  let pairs = 0;
  for (const r of rows.rows) {
    if (!r.sql) continue;
    const hits = extractJoinHits(r.sql, byQualified, byBare);
    for (const h of hits) {
      const fromId = byQualified.get(h.from);
      const toId = byQualified.get(h.to);
      if (!fromId || !toId || fromId === toId) continue;
      try {
        await upsertJoin({
          from_table_id: fromId,
          to_table_id: toId,
          from_columns: [h.fromCol],
          to_columns: [h.toCol],
          source: "observed",
          confidence: 0.7,
        });
        // Symmetric edge so the agent finds it from either direction.
        await upsertJoin({
          from_table_id: toId,
          to_table_id: fromId,
          from_columns: [h.toCol],
          to_columns: [h.fromCol],
          source: "observed",
          confidence: 0.7,
        });
        pairs++;
      } catch {
        // ignore upsert quirks; the next tick will retry
      }
    }
  }
  return pairs;
}

/** Walk a parsed SQL AST and return every JOIN ... ON a.col = b.col pair. */
function extractJoinHits(
  sql: string,
  byQualified: Map<string, number>,
  _byBare: Map<string, number[]>,
): JoinHit[] {
  let ast: unknown;
  try {
    ast = sqlParser.astify(sql.trim().replace(/;+\s*$/, ""), { database: "PostgreSQL" });
  } catch {
    return [];
  }
  const out: JoinHit[] = [];
  // Walk: collect alias→table map first, then collect ON conditions.
  const aliasToTable = new Map<string, string>();
  visit(ast, (node) => {
    if (!isObj(node)) return;
    // FROM / JOIN list entries
    const from = (node as { from?: unknown }).from;
    if (Array.isArray(from)) {
      for (const f of from) {
        if (!isObj(f)) continue;
        const tbl = (f as { table?: string }).table;
        const as = (f as { as?: string | null }).as;
        if (typeof tbl === "string") {
          if (as) aliasToTable.set(as, tbl);
          aliasToTable.set(tbl, tbl);
        }
      }
    }
    // ON expression
    const on = (node as { on?: unknown }).on;
    if (isObj(on)) {
      collectEquiJoins(on, aliasToTable, byQualified, out);
    }
  });
  return out;
}

function collectEquiJoins(
  expr: unknown,
  aliasToTable: Map<string, string>,
  byQualified: Map<string, number>,
  out: JoinHit[],
): void {
  if (!isObj(expr)) return;
  const op = (expr as { operator?: string }).operator;
  const type = (expr as { type?: string }).type;
  // AND/OR splits — recurse both sides.
  if (type === "binary_expr" && (op === "AND" || op === "OR")) {
    collectEquiJoins((expr as { left: unknown }).left, aliasToTable, byQualified, out);
    collectEquiJoins((expr as { right: unknown }).right, aliasToTable, byQualified, out);
    return;
  }
  if (type === "binary_expr" && op === "=") {
    const left = (expr as { left: unknown }).left;
    const right = (expr as { right: unknown }).right;
    const L = readColumnRef(left, aliasToTable);
    const R = readColumnRef(right, aliasToTable);
    if (!L || !R || L.table === R.table) return;
    // Only record if BOTH sides resolve to known tables.
    if (!byQualified.has(L.table) || !byQualified.has(R.table)) return;
    out.push({ from: L.table, fromCol: L.column, to: R.table, toCol: R.column });
  }
}

function readColumnRef(
  expr: unknown,
  aliasToTable: Map<string, string>,
): { table: string; column: string } | null {
  if (!isObj(expr)) return null;
  if ((expr as { type?: string }).type !== "column_ref") return null;
  const tableRaw = (expr as { table?: string | null }).table;
  // node-sql-parser sometimes returns column as `{ expr: { value: "name", type: "default" } }`
  // and sometimes as a bare string. Normalize both.
  const rawColumn = (expr as { column?: unknown }).column;
  let column: string | null = null;
  if (typeof rawColumn === "string") {
    column = rawColumn;
  } else if (isObj(rawColumn)) {
    const inner = (rawColumn as { expr?: unknown }).expr;
    if (isObj(inner) && typeof (inner as { value?: unknown }).value === "string") {
      column = (inner as { value: string }).value;
    }
  }
  if (!column || !tableRaw) return null;
  const table = aliasToTable.get(tableRaw) ?? tableRaw;
  return { table, column };
}

function visit(node: unknown, fn: (n: unknown) => void): void {
  if (Array.isArray(node)) {
    for (const x of node) visit(x, fn);
    return;
  }
  if (!isObj(node)) return;
  fn(node);
  for (const v of Object.values(node as Record<string, unknown>)) visit(v, fn);
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

// ─── Pass B: name match ───────────────────────────────────────────────────

async function mineNameMatches(): Promise<number> {
  // Find columns whose names look like FKs (*_id, *_key, *_uuid) and appear
  // in ≥ 2 tables that don't already share an FK on them.
  const cands = await catalogPool.query<{
    column_name: string;
    table_ids: number[];
  }>(
    `WITH ident_cols AS (
       SELECT column_name, table_id
         FROM columns
        WHERE (column_name ~* '(_id|_key|_uuid)$' OR column_name IN ('id','key','uuid'))
          AND fk_target IS NULL
     )
     SELECT column_name, array_agg(DISTINCT table_id) AS table_ids
       FROM ident_cols
      GROUP BY column_name
     HAVING count(DISTINCT table_id) >= 2
      ORDER BY count(DISTINCT table_id) DESC
      LIMIT $1`,
    [NAME_MATCH_LIMIT],
  );

  let pairs = 0;
  for (const c of cands.rows) {
    const ids = c.table_ids;
    for (let i = 0; i < ids.length; i++) {
      for (let j = 0; j < ids.length; j++) {
        if (i === j) continue;
        try {
          await upsertJoin({
            from_table_id: ids[i]!,
            to_table_id: ids[j]!,
            from_columns: [c.column_name],
            to_columns: [c.column_name],
            source: "name_match",
            confidence: 0.5,
            notes: `Inferred from shared column name "${c.column_name}". No FK declared.`,
          });
          pairs++;
        } catch {
          // ignore
        }
      }
    }
  }
  return pairs;
}
