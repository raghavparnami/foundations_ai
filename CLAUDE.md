# Loom

## Vision

Loom is to tables what Claude Code is to files. A user connects a database; a
background agent immediately starts profiling, documenting, and embedding every
table; a chat UI lets the user ask anything about that data with plan-mode
approval for any write. The defining property is that **Loom is always preparing**:
docs, profiles, lineage, and the semantic index update continuously in the
background, so by the time a user asks a question the agent already knows the
data deeply.

Reference product for build quality / polish: extend.ai (document processing).
Reference product for primitives: Claude Code itself (file processing).

## Primitive mapping (Claude Code → Loom)

| Claude Code (files)        | Loom (tables)                                                 |
| -------------------------- | ------------------------------------------------------------- |
| Read, Glob, Grep           | list_tables, describe_table, sample_rows, run_sql (SELECT)    |
| Edit, Write, Bash          | propose_view, propose_metric, update_doc                      |
| CLAUDE.md                  | Living semantic catalog (per-table .md + structured rows)     |
| Plan mode                  | Read-only mode; write tools gated behind explicit approval    |
| .claude/plans/*.md         | docs/plans/{conversation-id}.md                               |
| Skills (markdown playbooks)| Skills (analytical playbooks: cohort, funnel, deviation rate) |
| Hooks                      | on_table_added, on_schema_change, on_query_run, on_view_created |
| Subagents                  | profiler, documenter, sql-generator, reviewer, product-builder|
| MCP servers                | One MCP per data source: postgres, snowflake, bigquery, dbt   |

## v0.1 quickstart (demo build, 2026-05-16)

```bash
docker compose up -d                  # starts Postgres+pgvector on :5544
cp .env.local.example .env.local      # then paste OPENROUTER_API_KEY
npm install
npm run db:push                       # creates catalog tables
npm run db:seed                       # seeds manufacturing demo data
npm run dev                           # http://localhost:3001
```

To replay the "always preparing" animation live during a demo, run
`npm run demo:reset` (wipes catalog only, source data is untouched), then
refresh the browser. The boot route auto-detects an empty catalog and kicks
Loops 1 + 2 in the background while the user watches.

The current build is intentionally narrowed from the full vision below — see
`docs/plans/v0.1-demo.md` for the exact scope cuts and demo script.

## Tech stack (v0.1 build)

- **Runtime**: Node.js 20+, TypeScript strict, `noUncheckedIndexedAccess`
- **LLM**: OpenRouter → `deepseek/deepseek-chat-v3.1` for both the chat agent
  and the offline doc-writer. Key in `.env.local` (rotate after demo).
- **Agent**: AI SDK 6 (`ai`, `@ai-sdk/react`) with `@openrouter/ai-sdk-provider`.
  Tool-calling done natively by the SDK.
- **Catalog DB**: Postgres 16 + pgvector (Docker, port 5544)
- **ORM**: Drizzle (raw SQL only inside the `run_sql` tool, parsed via `node-sql-parser`)
- **Background workers**: in-process for v0.1; graphile-worker deferred
- **UI**: Next.js 15 App Router + Tailwind
- **Validation**: zod at every external boundary

## Architecture (four layers)

1. **Source layer** — the user's database(s). Loom never moves data; it queries in place.
2. **Catalog** — Postgres + pgvector. Stores structured metadata (tables, columns,
   tags, lineage, profile stats), the markdown docs, embeddings for retrieval,
   and the audit log of everything the agent did.
3. **Background workers** — three loops that keep the catalog fresh (see below).
4. **Agent + UI** — AI SDK powers the chat. Retrieval-augmented at every turn:
   relevant catalog entries are injected into context before the model responds.

**Loom is not "trained" on the data.** It retrieves. Updates are instant; every
answer is traceable to source docs in the audit log.

## The three background loops

**Loop 1 — Structural crawl** (trigger: schema-change detection, polling
`information_schema` in dev; CDC in prod)
- Pull column types, constraints, FKs, row count
- Profile each column: null rate, distinct count, min/max, top-N values,
  histogram for numerics, regex pattern detection for strings
- Write the **structural half** of `loom-catalog/{source}/{schema}/{table}.md`
- Upsert structured rows in `catalog.tables` / `catalog.columns`

**Loop 2 — Semantic enrichment** (trigger: nightly + on query-log delta)
- Pull recent queries: `pg_stat_statements` (Postgres), `ACCESS_HISTORY`
  (Snowflake), `INFORMATION_SCHEMA.JOBS` (BigQuery)
- Cluster queries per table
- Ask the LLM (offline, via the raw SDK — NOT the agent loop):
  "Given these N queries and this schema, what is this table about? What are
  common filter patterns? What does each column mean? What does it join with?"
- Write the **semantic half** of the markdown. Preserve human edits (see
  "Doc provenance" below)
- Re-embed and upsert into `catalog.embeddings` (pgvector)

**Loop 3 — Relationship discovery** (trigger: weekly)
- For frequently co-queried table pairs, infer join keys
- Write `catalog.lineage_edges`
- Detect duplicate metrics (3 views computing "active users" 3 ways → flag)

## Plan mode contract

The agent runs in one of two modes per conversation:

- **Execute mode (default for v0.1, v0.2)** — read tools always allowed; write
  tools blocked entirely
- **Plan mode (v0.3+)** — agent can call read tools, must write its plan to
  `docs/plans/{conversation-id}.md`, then call ExitPlanMode to request approval.
  After user approves, write tools unlock for that conversation only and require
  a second confirmation on first call.

Read tools: `list_tables`, `describe_table`, `sample_rows`, `run_sql` (SELECT-only,
enforced by parsing the SQL with a real parser, not regex).

Write tools (gated): `propose_view`, `propose_metric`, `update_doc`,
`create_tag`. Each one stages the change in a `catalog.proposals` row and
returns a preview; only an explicit second tool call executes it.

## Skills (v0.3+)

Markdown files in `packages/skills/` (later: `src/skills/`). Each is a playbook.
Format (see CLAUDE.md history for the canonical example, e.g. `deviation-rate`):

- Front matter with `name`, `description`, trigger keywords
- "What it is", "Required columns", "SQL template", "Common mistakes",
  "What a good output looks like"

Agent has a `skill_search` tool. Users can force-load via `/skill {name}`.

## Doc provenance

Every paragraph in a generated markdown doc has a comment tag indicating
origin: `<!-- provenance: schema | query-log | claude | human -->`.

Loops 1 and 2 must **preserve** any paragraph tagged `human` — never overwrite,
never reorder. LLM-generated paragraphs CAN be replaced on regeneration.

## Conventions

- TypeScript strict, `noUncheckedIndexedAccess: true`
- No `any`. Use `unknown` and narrow with zod or type guards.
- All catalog-DB access through Drizzle. Source DB queries go through `pg` directly
  (since we're reading user-owned schemas we don't model).
- All tool handlers return AI SDK content. Never throw — return a structured
  error object so the agent can see and react to it.
- Long-running ops: enqueue and return a job id. Tool handlers must return in
  under 5 seconds.
- Logging: every log line gets actor + action (+ requestId once we have it).
- Migrations are forward-only.

## What to defer (anti-scope-creep)

OUT OF SCOPE until the named phase:

- Multi-source / multi-tenant — phase 0.5+
- Auth — phase 0.5
- Snowflake / BigQuery MCPs — phase 0.5
- Semantic layer integration (WrenAI / Cube) — phase 0.6
- Slack integration — phase 0.7
- Embeddings via anything other than text-embedding-3-small — phase 1.0
- Self-hosted model fallback — phase 1.0+
- Subagents — phase 0.6 (single agent until then)

## Build phases

- [ ] **v0.1** — chat works end-to-end against one local Postgres. Read tools only. (Monday demo target)
- [ ] **v0.2** — three background loops shipped. Catalog populated. Agent retrieves at every turn.
- [ ] **v0.3** — plan mode + skill system. Three starter skills.
- [ ] **v0.4** — admin dashboard.
- [ ] **v0.5** — Snowflake MCP, auth, multi-tenancy.
- [ ] **v0.6** — semantic layer integration. Subagents (profiler, reviewer).
- [ ] **v0.7** — Slack bot. Public beta.

## Plan mode is mandatory (post-v0.1)

After the Monday demo, every Claude Code session on this repo should open in
plan mode. Write plans to `docs/plans/v{X.Y}.md` (phase work) or
`docs/plans/{conversation-id}.md` (one-off). Include file-level diff, order of
implementation, open questions, S/M/L complexity per task.
