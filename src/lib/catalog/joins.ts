/**
 * Joins graph — queries + helpers.
 *
 * The agent's `resolve_join` tool reads from here; Loop 2 uses
 * `listJoinsForTable` to render wiki "Common joins" sections; the boot path
 * calls `backfillFkJoins` once on every push to keep the FK rows in sync
 * with information_schema.
 */
import { catalogPool } from "./db";

export type JoinSource = "fk" | "observed" | "name_match" | "skill" | "human";

export type JoinRow = {
  id: number;
  from_table_id: number;
  to_table_id: number;
  from_columns: string[];
  to_columns: string[];
  cardinality: string | null;
  confidence: number;
  source: JoinSource;
  observed_count: number;
  last_seen_at: string | null;
  notes: string | null;
  // Convenience: filled when joined to `tables`.
  from_qualified?: string;
  to_qualified?: string;
};

/**
 * Insert or update a join with conflict on the unique key. Bumps
 * observed_count on every upsert; promotes confidence to `max(existing, new)`
 * so a stronger source never gets overwritten by a weaker one.
 */
export async function upsertJoin(input: {
  from_table_id: number;
  to_table_id: number;
  from_columns: string[];
  to_columns: string[];
  source: JoinSource;
  confidence: number;
  cardinality?: string | null;
  notes?: string | null;
}): Promise<void> {
  await catalogPool.query(
    `INSERT INTO joins
        (from_table_id, to_table_id, from_columns, to_columns,
         cardinality, confidence, source, observed_count, last_seen_at, notes)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, 1, NOW(), $8)
     ON CONFLICT (from_table_id, to_table_id, from_columns, to_columns)
     DO UPDATE SET
        confidence     = GREATEST(joins.confidence, EXCLUDED.confidence),
        source         = CASE WHEN EXCLUDED.confidence > joins.confidence
                              THEN EXCLUDED.source ELSE joins.source END,
        observed_count = joins.observed_count + 1,
        last_seen_at   = NOW(),
        cardinality    = COALESCE(EXCLUDED.cardinality, joins.cardinality),
        notes          = COALESCE(EXCLUDED.notes, joins.notes),
        updated_at     = NOW()`,
    [
      input.from_table_id,
      input.to_table_id,
      JSON.stringify(input.from_columns),
      JSON.stringify(input.to_columns),
      input.cardinality ?? null,
      input.confidence,
      input.source,
      input.notes ?? null,
    ],
  );
}

/** All known joins originating from one table, ordered by confidence. */
export async function listJoinsForTable(tableId: number): Promise<JoinRow[]> {
  const r = await catalogPool.query<JoinRow>(
    `SELECT j.id, j.from_table_id, j.to_table_id,
            j.from_columns, j.to_columns, j.cardinality,
            j.confidence::float8 AS confidence,
            j.source, j.observed_count,
            j.last_seen_at::text AS last_seen_at, j.notes,
            ft.schema_name || '.' || ft.table_name AS from_qualified,
            tt.schema_name || '.' || tt.table_name AS to_qualified
       FROM joins j
       JOIN tables ft ON ft.id = j.from_table_id
       JOIN tables tt ON tt.id = j.to_table_id
      WHERE j.from_table_id = $1
      ORDER BY j.confidence DESC, j.observed_count DESC`,
    [tableId],
  );
  return r.rows;
}

/** Best known join between a specific pair (in either direction). */
export async function resolveJoinPair(
  fromQualified: string,
  toQualified: string,
): Promise<JoinRow | null> {
  const r = await catalogPool.query<JoinRow>(
    `SELECT j.id, j.from_table_id, j.to_table_id,
            j.from_columns, j.to_columns, j.cardinality,
            j.confidence::float8 AS confidence,
            j.source, j.observed_count,
            j.last_seen_at::text AS last_seen_at, j.notes,
            ft.schema_name || '.' || ft.table_name AS from_qualified,
            tt.schema_name || '.' || tt.table_name AS to_qualified
       FROM joins j
       JOIN tables ft ON ft.id = j.from_table_id
       JOIN tables tt ON tt.id = j.to_table_id
      WHERE (ft.schema_name || '.' || ft.table_name = $1
             AND tt.schema_name || '.' || tt.table_name = $2)
         OR (ft.schema_name || '.' || ft.table_name = $2
             AND tt.schema_name || '.' || tt.table_name = $1)
      ORDER BY j.confidence DESC, j.observed_count DESC
      LIMIT 1`,
    [fromQualified, toQualified],
  );
  return r.rows[0] ?? null;
}

/**
 * Walk `columns.fk_target` and ensure every declared FK has both directions
 * recorded as confidence-1.0 'fk' rows in the joins table. Safe to re-run.
 *
 * fk_target format from Loop 1: "schema.table.column" (e.g. "public.production_runs.run_id").
 */
export async function backfillFkJoins(): Promise<{ inserted: number }> {
  const rows = await catalogPool.query<{
    from_table_id: number;
    from_column: string;
    fk_target: string;
  }>(
    `SELECT c.table_id AS from_table_id,
            c.column_name AS from_column,
            c.fk_target
       FROM columns c
      WHERE c.fk_target IS NOT NULL AND c.fk_target <> ''`,
  );

  let inserted = 0;
  for (const r of rows.rows) {
    const parts = r.fk_target.split(".");
    if (parts.length < 3) continue;
    const targetCol = parts[parts.length - 1]!;
    const targetTable = parts[parts.length - 2]!;
    const targetSchema = parts.slice(0, parts.length - 2).join(".");

    const toRow = await catalogPool.query<{ id: number }>(
      `SELECT id FROM tables WHERE schema_name = $1 AND table_name = $2 LIMIT 1`,
      [targetSchema, targetTable],
    );
    const toId = toRow.rows[0]?.id;
    if (!toId) continue;

    // Both directions — agents often query in either order.
    await upsertJoin({
      from_table_id: r.from_table_id,
      to_table_id: toId,
      from_columns: [r.from_column],
      to_columns: [targetCol],
      source: "fk",
      confidence: 1.0,
      cardinality: "1:N",
    });
    await upsertJoin({
      from_table_id: toId,
      to_table_id: r.from_table_id,
      from_columns: [targetCol],
      to_columns: [r.from_column],
      source: "fk",
      confidence: 1.0,
      cardinality: "1:N",
    });
    inserted += 2;
  }
  return { inserted };
}

/**
 * Render the agent-facing "Common joins" markdown for one table from the
 * joins graph. Confidence-ranked, sourcing badge included.
 */
export async function renderCommonJoinsMd(tableId: number): Promise<string> {
  const joins = await listJoinsForTable(tableId);
  if (joins.length === 0) return "_No joins recorded yet._";
  const lines: string[] = [];
  for (const j of joins) {
    const fromCols = j.from_columns.join(", ");
    const toCols = j.to_columns.join(", ");
    const sourceTag = j.source === "fk" ? "FK" : j.source.toUpperCase();
    const conf = j.confidence.toFixed(2);
    lines.push(
      `- \`JOIN ${j.to_qualified} ON ${j.from_qualified}.${fromCols} = ${j.to_qualified}.${toCols}\`` +
        `  *(${sourceTag}, confidence ${conf}${j.observed_count > 0 ? `, seen ${j.observed_count}×` : ""})*`,
    );
  }
  return lines.join("\n");
}
