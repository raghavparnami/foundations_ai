# Loom — One-Page Runbook

Tight version of [`setup/README.md`](README.md). Five commands, in order.

```bash
# 1. Postgres + pgvector on :5544 (creates loom_catalog + loom_demo_source)
docker compose up -d

# 2. Install Node deps
npm install

# 3. Apply the foundation_ai schema (28 tables — idempotent)
npm run db:push
# or, without Node:
# psql "postgres://loom:loom@localhost:5544/loom_catalog" -f setup/sql/01-loom-catalog-schema.sql

# 4. Seed ~2,000 rows of manufacturing demo data
npm run db:seed
# or:
# psql "postgres://loom:loom@localhost:5544/loom_demo_source" -f setup/seed/manufacturing.sql

# 5. Configure env + run
cp setup/env.example .env.local       # set OPENROUTER_API_KEY in here
npm run dev                           # http://localhost:3001
```

On first page load the boot loop fires automatically — Loop 1 profiles every table, Loop 2 LLM-generates per-table semantic docs. Chat goes live as soon as any table reaches `status='ready'`.

Wipe + replay (catalog only, source data untouched):

```bash
npm run demo:reset
```

Full setup details: [`setup/README.md`](README.md).
