# Loom — Setup Guide

End-to-end setup for the legacy Next.js app at the repo root. After running the steps below you'll have:

- Postgres 16 + pgvector running in Docker on port **5544**
- Two databases: `loom_catalog` (Loom's metadata, all under the `foundation_ai` schema) and `loom_demo_source` (a manufacturing dataset to query against)
- The full `foundation_ai` DDL applied — 28 tables, indexes, generated tsvectors, HNSW vector indexes, audit log
- ~2,000 rows of realistic manufacturing data seeded into `loom_demo_source`
- A `.env.local` with the secrets Loom needs to run

The contents of this folder:

```
setup/
├── README.md                          this file
├── env.example                        copy → repo root /.env.local and fill in OPENROUTER_API_KEY
├── RUNBOOK.md                         tighter one-page step list (skip the prose)
├── sql/
│   ├── 00-create-databases.sh         creates loom_catalog + loom_demo_source + enables pgvector
│   ├── 01-loom-catalog-schema.sql     ALL 28 tables + indexes + ALTERs — idempotent, safe to re-run
└── seed/
    └── manufacturing.sql              DDL + ~2,000 rows: production_runs, deviations, equipment, etc.
```

---

## Prerequisites

- **Docker** (or any Postgres 16+ instance with `pgvector` available — see the "Bring your own Postgres" appendix below)
- **Node.js 20+** and **npm**
- An **OpenRouter API key** (https://openrouter.ai/keys) — Loom uses DeepSeek v3.1 via OpenRouter for both the chat agent and the offline doc-writer. Optionally an `OPENAI_API_KEY` if you want embeddings populated for hybrid retrieval.

---

## Step-by-step

### 1. Start Postgres

From the repo root:

```bash
docker compose up -d
```

This runs `pgvector/pgvector:pg16` on port `5544` and on first boot executes `db-init/01-create-databases.sh`, which creates `loom_catalog` + `loom_demo_source` and enables the `vector` extension.

Verify:

```bash
docker compose ps
docker exec loom-postgres psql -U loom -d loom_catalog -c '\dx'
# Should list the `vector` extension.
```

If you bind to a different port or use a managed Postgres instead, see the appendix.

### 2. Apply the catalog schema

The legacy app has a built-in idempotent push script:

```bash
npm install
npm run db:push
```

If you'd rather apply the DDL directly (no Node required), use the dumped SQL:

```bash
psql "postgres://loom:loom@localhost:5544/loom_catalog" -f setup/sql/01-loom-catalog-schema.sql
```

Both paths produce the same result. They're idempotent — every `CREATE` uses `IF NOT EXISTS` and every `ALTER` uses `ADD COLUMN IF NOT EXISTS`. Safe to re-run.

### 3. Seed the demo source data

```bash
npm run db:seed
```

or directly:

```bash
psql "postgres://loom:loom@localhost:5544/loom_demo_source" -f setup/seed/manufacturing.sql
```

This drops + recreates 5 source tables (`operators`, `equipment`, `production_runs`, `deviations`, `quality_checks`) and inserts realistic data: some failed runs, deviations across temperature/pressure/contamination/alignment categories, equipment with maintenance histories, operators across shifts, quality checks tagged in/out of spec.

### 4. Configure environment

Copy the template and fill it in:

```bash
cp setup/env.example .env.local
$EDITOR .env.local
```

Required keys:

| Var | Notes |
|---|---|
| `OPENROUTER_API_KEY` | Required. Get from https://openrouter.ai/keys. |
| `LOOM_CATALOG_URL` | Defaults to `postgres://loom:loom@localhost:5544/loom_catalog`. |
| `LOOM_DEMO_SOURCE_URL` | Defaults to `postgres://loom:loom@localhost:5544/loom_demo_source`. |
| `LOOM_AGENT_MODEL` | OpenRouter model slug. Default `deepseek/deepseek-chat-v3.1`. |
| `LOOM_DOC_WRITER_MODEL` | Same model used for offline doc generation. |

Optional:

| Var | Notes |
|---|---|
| `OPENAI_API_KEY` | Enables embeddings. Without it, retrieval falls back to lexical-only — still works, just less semantic recall. |
| `ANTHROPIC_API_KEY` | Reserved for future provider swaps. |

### 5. Run the app

```bash
npm run dev
# → http://localhost:3001
```

On first page load, Loom hits `/api/ensure-setup` which kicks Loop 1 (structural crawl + per-column profiling) and Loop 2 (semantic doc generation). The right-side "preparing" panel streams progress. The chat is live once any table goes to `status='ready'`.

### 6. Replay the boot animation (optional)

If you want to demo the "always preparing" animation cleanly:

```bash
npm run demo:reset
```

This `TRUNCATE`s the catalog tables only (source data is untouched). Refresh the browser → Loop 1 + Loop 2 fire again.

---

## What the schema contains

The `foundation_ai` schema (in `loom_catalog`) holds **28 tables**:

| Concern | Tables |
|---|---|
| **Source registry** | `sources`, `tables`, `columns`, `column_profiles`, `docs`, `embeddings` |
| **Skills + candidates** | `skills`, `skill_candidates` |
| **Proposals + projects** | `proposals`, `projects`, `project_tables` |
| **Conversations + messages** | `conversations`, `messages` |
| **Generated artifacts** | `reports`, `charts`, `insights` |
| **Joins graph** | `joins` |
| **Memory** | `memories` |
| **Wiki** | `wiki_domains`, `wiki_pages`, `wiki_links`, `wiki_tags`, `wiki_page_tags`, `wiki_log`, `wiki_agent_state` |
| **Unstructured corpus** | `documents`, `doc_chunks` |
| **Code corpus** | `code_sources`, `code_files` |
| **Audit** | `audit_log` |

All have `IF NOT EXISTS` guards so the DDL can be re-applied on a populated database without dropping data.

Vector columns (`embeddings.vec`, `wiki_pages.embedding`, `doc_chunks.embedding`) are `vector(1536)`, sized for OpenAI's `text-embedding-3-small`. The HNSW indexes on those columns use the pgvector default tuning (`m=16, ef_construction=64`).

---

## Bring your own Postgres (appendix)

If you don't want Docker:

1. Point a Postgres 16+ instance with `pgvector >= 0.5` available.
2. Create the two databases manually:

   ```sql
   CREATE DATABASE loom_catalog;
   CREATE DATABASE loom_demo_source;
   \c loom_catalog
   CREATE EXTENSION vector;
   ```

3. Update `LOOM_CATALOG_URL` and `LOOM_DEMO_SOURCE_URL` in `.env.local` to point at your instance.
4. Run `npm run db:push` (or `psql -f setup/sql/01-loom-catalog-schema.sql`) and `npm run db:seed`.

---

## Troubleshooting

**`db:push` fails with "extension 'vector' is not available"** — your Postgres image doesn't bundle pgvector. Use `pgvector/pgvector:pg16` (the Docker compose default) or install the extension manually.

**`ensure-setup` returns `already_started` but tables stay at `pending`** — the boot loop crashed; look at the terminal where you ran `npm run dev` for the stack trace. Common cause: `OPENROUTER_API_KEY` not set, so Loop 2 hits a 401.

**Demo replay doesn't kick** — `npm run demo:reset` clears `globalThis.__loomBootKicked` indirectly by truncating the catalog. If the in-memory flag is still set from a previous run, restart `npm run dev`.

**HNSW index creation hangs on a large catalog** — that's expected the first time. The index is created lazily; for >100K tables, use `SET maintenance_work_mem = '2GB'` before applying the DDL.
