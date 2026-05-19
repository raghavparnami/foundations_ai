# View creation rules

These rules apply to every LLM-generated view (Loop 4 proactive seeder; the
chat agent's `propose_view` path is human-gated and inherits these via the
seeder's behavior). The worker appends this file to its structural system
prompt at runtime, so edits here take effect on the next LLM call — no restart
needed.

## Content quality

- **Aggregate, don't dump.** Every view produces at least one rate, count, total, top-N, or time-series row. Never `SELECT *` — that's a table, not a view worth pre-building.
- **Time-bound by default.** Use `WHERE ts >= NOW() - INTERVAL '<window>'` unless the metric is genuinely point-in-time. Common windows: `7 days`, `30 days`, `90 days`. For time series, use `DATE_TRUNC('week', col)` or `DATE_TRUNC('month', col)`.
- **Name reflects content.** `snake_case`, descriptive, with a time-range suffix when relevant: `deviation_rate_by_line_30d`, `weekly_production_trend`, `top_equipment_by_severity_90d`. No `v_` or `view_` prefix — the catalog adds its own namespace.
- **Description = one sentence + unit.** Good: "Daily count of production runs by line over the last 30 days." Bad: "Shows production data."
- **Use only listed columns.** Never invent columns or tables. If the doc doesn't list a column, the column does not exist for this purpose.
- **Joins via FKs only.** If the column docs don't surface a foreign key between two tables, don't join them — even if the names look related.
- **One metric per view.** Don't bundle three unrelated KPIs into one wide row. Separate views compose better.

## Creation / skip

- **Skip low-signal tables.** If the underlying table has `row_count < 100` in the catalog, don't propose a view over it. The aggregate would be noise.
- **Skip name collisions.** If a view with the proposed name already exists in `loom_views`, **skip** — don't `CREATE OR REPLACE`. Either pick a different name or use the existing view.
- **Skip trivial re-projections.** A view that selects three columns from one table with renamed aliases is not a view. Drop it.
- **One metric, one view.** Don't propose three views that compute the same underlying KPI three ways. If a metric already exists under any name, surface that instead of recreating.
- **Honor the seed cap.** Loop 4 caps at `MAX_SEED` per pass. Don't try to bypass with bundled SQL.
- **SELECT-only.** `SELECT` or `WITH ... SELECT` only. No DDL, no DML, no semicolons. Enforced by [`src/lib/agent/sql-guard.ts`](../../src/lib/agent/sql-guard.ts), but stated here so the LLM doesn't waste tokens generating things that'll be rejected.
- **No empty CTEs.** If a `WITH` block produces zero rows under realistic data, the view fails on first query. Use defensive aggregates (`COUNT(*) FILTER (WHERE ...)`, `COALESCE(..., 0)`) so the view is robust to empty windows.
