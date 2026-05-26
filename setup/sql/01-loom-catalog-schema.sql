-- =====================================================================
-- Loom catalog schema — full DDL for the `loom_catalog` database.
--
-- Apply to a Postgres 16+ instance with pgvector installed:
--     psql "postgres://loom:loom@localhost:5544/loom_catalog" \
--          -f setup/sql/01-loom-catalog-schema.sql
--
-- Idempotent: every CREATE uses IF NOT EXISTS; every ALTER uses ADD
-- COLUMN IF NOT EXISTS. Safe to re-run on a populated catalog.
--
-- All Loom-owned tables live in the `foundation_ai` schema. The legacy
-- Next.js app sets search_path on every connection so unqualified SQL
-- in the codebase lands here.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS foundation_ai;
SET search_path = foundation_ai, public;

-- ─── Sources + tables + columns + profiles ───────────────────────────────

CREATE TABLE IF NOT EXISTS sources (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  kind            TEXT NOT NULL,
  conn_url        TEXT NOT NULL,
  included_tables JSONB,            -- null = all; ["schema.name", ...] = restricted
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE sources ADD COLUMN IF NOT EXISTS included_tables JSONB;

CREATE TABLE IF NOT EXISTS tables (
  id                  SERIAL PRIMARY KEY,
  source_id           INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  schema_name         TEXT NOT NULL,
  table_name          TEXT NOT NULL,
  row_count           BIGINT,
  status              TEXT NOT NULL DEFAULT 'pending',
  last_profiled_at    TIMESTAMPTZ,
  last_enriched_at    TIMESTAMPTZ,
  schema_hash         TEXT,        -- md5 of column signatures; null = never profiled
  dirty               BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (source_id, schema_name, table_name)
);
ALTER TABLE tables ADD COLUMN IF NOT EXISTS schema_hash TEXT;
ALTER TABLE tables ADD COLUMN IF NOT EXISTS dirty BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS columns (
  id            SERIAL PRIMARY KEY,
  table_id      INTEGER NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  column_name   TEXT NOT NULL,
  ordinal       INTEGER NOT NULL,
  data_type     TEXT NOT NULL,
  is_nullable   BOOLEAN NOT NULL,
  is_primary    BOOLEAN NOT NULL DEFAULT FALSE,
  fk_target     TEXT,
  UNIQUE (table_id, column_name)
);
CREATE INDEX IF NOT EXISTS col_table_idx ON columns(table_id);

CREATE TABLE IF NOT EXISTS column_profiles (
  id              SERIAL PRIMARY KEY,
  column_id       INTEGER NOT NULL UNIQUE REFERENCES columns(id) ON DELETE CASCADE,
  null_rate       DOUBLE PRECISION,
  distinct_count  BIGINT,
  min_value       TEXT,
  max_value       TEXT,
  top_values      JSONB,
  histogram       JSONB,
  sample_values   JSONB,
  profiled_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Generated table docs + embeddings ───────────────────────────────────

CREATE TABLE IF NOT EXISTS docs (
  id            SERIAL PRIMARY KEY,
  table_id      INTEGER NOT NULL UNIQUE REFERENCES tables(id) ON DELETE CASCADE,
  path          TEXT NOT NULL,
  markdown      TEXT NOT NULL,
  provenance    JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS embeddings (
  id            SERIAL PRIMARY KEY,
  table_id      INTEGER NOT NULL UNIQUE REFERENCES tables(id) ON DELETE CASCADE,
  vec           vector(1536) NOT NULL,
  content_hash  TEXT,        -- md5 of the embedded text; lets backfill skip unchanged docs
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE embeddings ADD COLUMN IF NOT EXISTS content_hash TEXT;
CREATE INDEX IF NOT EXISTS embeddings_vec_hnsw
  ON embeddings USING hnsw (vec vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ─── Skills (analytical playbooks the agent loads on matching triggers) ─

CREATE TABLE IF NOT EXISTS skills (
  id            SERIAL PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL,
  triggers      JSONB NOT NULL DEFAULT '[]'::jsonb,
  body_md       TEXT NOT NULL,
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS skill_candidates (
  id              SERIAL PRIMARY KEY,
  conversation_id TEXT,
  slug            TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL,
  triggers        JSONB NOT NULL DEFAULT '[]'::jsonb,
  body_md         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | dismissed
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sc_status_idx ON skill_candidates(status, created_at DESC);

-- ─── Views / metric proposals + projects ─────────────────────────────────

CREATE TABLE IF NOT EXISTS proposals (
  id            SERIAL PRIMARY KEY,
  kind          TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  sql           TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'applied',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (kind, name)
);

CREATE TABLE IF NOT EXISTS projects (
  id            SERIAL PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_tables (
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  table_id      INTEGER NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  added_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, table_id)
);
CREATE INDEX IF NOT EXISTS pt_table_idx ON project_tables(table_id);

-- ─── Reports + charts (generated artifacts) ──────────────────────────────

CREATE TABLE IF NOT EXISTS reports (
  id              SERIAL PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  body_md         TEXT NOT NULL,
  conversation_id TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS charts (
  id              SERIAL PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  spec            JSONB NOT NULL,
  conversation_id TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Conversations + persisted messages ──────────────────────────────────

CREATE TABLE IF NOT EXISTS conversations (
  id              SERIAL PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL DEFAULT 'New conversation',
  project_slug    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id              SERIAL PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  message_id      TEXT NOT NULL,        -- AI SDK UIMessage id (stable across re-render)
  ord             INTEGER NOT NULL,     -- monotonic position within the conversation
  role            TEXT NOT NULL,        -- 'user' | 'assistant' | 'system'
  parts           JSONB NOT NULL,       -- the UIMessage parts array
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (conversation_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_messages_conv_ord ON messages(conversation_id, ord);

-- ─── Insights (extracted observations from views) ────────────────────────

CREATE TABLE IF NOT EXISTS insights (
  id          SERIAL PRIMARY KEY,
  view_slug   TEXT NOT NULL,
  headline    TEXT NOT NULL,
  body        TEXT,
  importance  INTEGER NOT NULL DEFAULT 3,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (view_slug, headline)
);
CREATE INDEX IF NOT EXISTS insights_importance_idx
  ON insights(importance DESC, created_at DESC);

-- ─── Joins graph (FK + observed + name-match) ────────────────────────────

CREATE TABLE IF NOT EXISTS joins (
  id              SERIAL PRIMARY KEY,
  from_table_id   INTEGER NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  to_table_id     INTEGER NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  from_columns    JSONB NOT NULL,                     -- ["run_id"] or composite ["a","b"]
  to_columns      JSONB NOT NULL,
  cardinality     TEXT,                               -- '1:1' | '1:N' | 'N:M'
  confidence      NUMERIC(3,2) NOT NULL,
  source          TEXT NOT NULL
                  CHECK (source IN ('fk','observed','name_match','skill','human')),
  observed_count  INTEGER NOT NULL DEFAULT 0,
  last_seen_at    TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (from_table_id, to_table_id, from_columns, to_columns)
);
CREATE INDEX IF NOT EXISTS joins_from_idx ON joins(from_table_id, confidence DESC);
CREATE INDEX IF NOT EXISTS joins_pair_idx ON joins(from_table_id, to_table_id);

-- ─── Agent memory (long + short-term TTL) ────────────────────────────────

CREATE TABLE IF NOT EXISTS memories (
  id              SERIAL PRIMARY KEY,
  scope           TEXT NOT NULL CHECK (scope IN ('user','workspace')),
  kind            TEXT NOT NULL,  -- preference | fact | rule | glossary | other
  content         TEXT NOT NULL,
  importance      INTEGER NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  source          TEXT NOT NULL DEFAULT 'agent', -- 'user' | 'agent' | 'auto'
  conversation_id TEXT,
  status          TEXT NOT NULL DEFAULT 'active', -- active | archived | pending
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at    TIMESTAMPTZ,
  use_count       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS memories_scope_kind_idx
  ON memories(scope, kind, importance DESC, use_count DESC);
CREATE INDEX IF NOT EXISTS memories_active_idx
  ON memories(status, enabled) WHERE status = 'active' AND enabled = TRUE;

-- Two-tier memory: 'short' auto-saves every chat turn (7-day TTL); 'long' is
-- user-curated and never expires.
ALTER TABLE memories ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'long'
  CHECK (tier IN ('short','long'));
ALTER TABLE memories ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS memories_expires_idx ON memories(expires_at)
  WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS memories_tier_idx ON memories(tier, created_at DESC);

-- Per-conversation snapshot lives on the conversations row itself.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS summary_md TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pinned_facts JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_summarized_at TIMESTAMPTZ;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS summarized_turn_count INTEGER NOT NULL DEFAULT 0;

-- ─── Wiki (3 corpora: tables / docs / code) ──────────────────────────────

-- Domains: top-level groupings discovered by the LLM. Domains cut across
-- corpora — they're the navigation axis, not the source type.
CREATE TABLE IF NOT EXISTS wiki_domains (
  id              SERIAL PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  description     TEXT,
  color           TEXT,                       -- hex tag color for UI grouping
  sort_order      INTEGER NOT NULL DEFAULT 100,
  status          TEXT NOT NULL DEFAULT 'ready',
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Append-only event log for the wiki agents.
CREATE TABLE IF NOT EXISTS wiki_log (
  id              SERIAL PRIMARY KEY,
  ts              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  kind            TEXT NOT NULL,              -- ingest | regen | lint | fix
  target_kind     TEXT,
  target_slug     TEXT,
  domain_slug     TEXT,
  summary         TEXT NOT NULL,
  details         JSONB
);
CREATE INDEX IF NOT EXISTS wiki_log_ts_idx ON wiki_log(ts DESC);
CREATE INDEX IF NOT EXISTS wiki_log_domain_idx ON wiki_log(domain_slug, ts DESC);

CREATE TABLE IF NOT EXISTS wiki_tags (
  id              SERIAL PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  hint            TEXT,
  page_count      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS wiki_pages (
  id              SERIAL PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN ('tables','docs','code')),
  slug            TEXT NOT NULL,
  title           TEXT NOT NULL,
  summary         TEXT,                          -- 1-line teaser shown in tree nav
  body_md         TEXT NOT NULL,                 -- full markdown body with [[slug]] cross-links
  source_ref      JSONB,                         -- corpus-specific pointer
  content_hash    TEXT NOT NULL,                 -- md5 of body_md+source_ref; skip unchanged
  status          TEXT NOT NULL DEFAULT 'ready', -- generating | ready | stale | failed
  generated_at    TIMESTAMPTZ,
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (kind, slug)
);
CREATE INDEX IF NOT EXISTS wiki_kind_idx ON wiki_pages(kind, updated_at DESC);

-- Domain + page_type + corpus columns added in v0.4.1.
ALTER TABLE wiki_pages ADD COLUMN IF NOT EXISTS domain_id INTEGER
  REFERENCES wiki_domains(id) ON DELETE SET NULL;
ALTER TABLE wiki_pages ADD COLUMN IF NOT EXISTS page_type TEXT NOT NULL DEFAULT 'source';
-- page_type ∈ ('domain'|'concept'|'source'|'index'|'log')
ALTER TABLE wiki_pages ADD COLUMN IF NOT EXISTS corpus TEXT;
CREATE INDEX IF NOT EXISTS wiki_pages_domain_idx ON wiki_pages(domain_id, page_type);
CREATE INDEX IF NOT EXISTS wiki_pages_type_idx ON wiki_pages(page_type, updated_at DESC);

-- Embedding + tsvector for hybrid retrieval.
ALTER TABLE wiki_pages ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE wiki_pages ADD COLUMN IF NOT EXISTS embedded_hash TEXT;
ALTER TABLE wiki_pages ADD COLUMN IF NOT EXISTS tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')),   'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(body_md, '')), 'C')
  ) STORED;
CREATE INDEX IF NOT EXISTS wiki_pages_tsv_idx ON wiki_pages USING gin(tsv);
CREATE INDEX IF NOT EXISTS wiki_pages_emb_hnsw
  ON wiki_pages USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE TABLE IF NOT EXISTS wiki_page_tags (
  page_id   INTEGER NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  tag_id    INTEGER NOT NULL REFERENCES wiki_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (page_id, tag_id)
);
CREATE INDEX IF NOT EXISTS wiki_page_tags_tag_idx ON wiki_page_tags(tag_id);

CREATE TABLE IF NOT EXISTS wiki_links (
  from_page_id  INTEGER NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  to_kind       TEXT NOT NULL,
  to_slug       TEXT NOT NULL,
  PRIMARY KEY (from_page_id, to_kind, to_slug)
);
CREATE INDEX IF NOT EXISTS wiki_links_to_idx ON wiki_links(to_kind, to_slug);

-- ─── Documents corpus (user-uploaded PDFs, docs, runbooks) ───────────────

CREATE TABLE IF NOT EXISTS documents (
  id              SERIAL PRIMARY KEY,
  origin          TEXT NOT NULL CHECK (origin IN ('upload','sharepoint','url')),
  uri             TEXT NOT NULL,                  -- filename or remote path
  display_name    TEXT NOT NULL,
  mime            TEXT NOT NULL,
  size_bytes      BIGINT NOT NULL,
  content_hash    TEXT NOT NULL,                  -- md5 of raw bytes; UNIQUE so re-upload is idempotent
  body_text       TEXT NOT NULL,                  -- extracted plain text
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  indexed_at      TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'pending',-- pending | indexed | failed
  UNIQUE (origin, content_hash)
);
CREATE INDEX IF NOT EXISTS documents_status_idx ON documents(status, uploaded_at DESC);

-- Track the content hash that was summarized last; the docs wiki agent skips
-- the LLM call when content_hash matches this.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS last_indexed_hash TEXT;

CREATE TABLE IF NOT EXISTS doc_chunks (
  id            SERIAL PRIMARY KEY,
  document_id   INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ord           INTEGER NOT NULL,
  text          TEXT NOT NULL,
  embedding     vector(1536),                   -- nullable; populated only if OPENAI_API_KEY set
  UNIQUE (document_id, ord)
);

-- ─── Code corpus (GitLab/GitHub repos) ───────────────────────────────────

CREATE TABLE IF NOT EXISTS code_sources (
  id              SERIAL PRIMARY KEY,
  provider        TEXT NOT NULL CHECK (provider IN ('gitlab','github')),
  display_name    TEXT NOT NULL,
  project_path    TEXT NOT NULL,
  base_url        TEXT NOT NULL DEFAULT 'https://gitlab.com',
  token_ref       TEXT,                           -- env-var name holding the PAT, never the token itself
  default_branch  TEXT NOT NULL DEFAULT 'main',
  include_globs   JSONB NOT NULL DEFAULT '["**/*.md","**/*.ts","**/*.py","**/*.sql"]'::jsonb,
  exclude_globs   JSONB NOT NULL DEFAULT '["node_modules/**","dist/**","build/**",".git/**"]'::jsonb,
  last_synced_at  TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'pending',-- pending | syncing | ready | failed
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, project_path)
);

CREATE TABLE IF NOT EXISTS code_files (
  id              SERIAL PRIMARY KEY,
  code_source_id  INTEGER NOT NULL REFERENCES code_sources(id) ON DELETE CASCADE,
  path            TEXT NOT NULL,
  blob_sha        TEXT NOT NULL,
  language        TEXT,
  size_bytes      INTEGER NOT NULL,
  body            TEXT NOT NULL,                  -- raw text (cap ~1MB)
  indexed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (code_source_id, path)
);
CREATE INDEX IF NOT EXISTS code_files_src_idx ON code_files(code_source_id);

-- Per-agent state for the wiki runner — coordinates cadence + soft locks.
CREATE TABLE IF NOT EXISTS wiki_agent_state (
  kind            TEXT PRIMARY KEY CHECK (kind IN ('tables','docs','code')),
  last_run_at     TIMESTAMPTZ,
  last_status     TEXT,                           -- ok | failed
  last_error      TEXT,
  pages_generated INTEGER NOT NULL DEFAULT 0,
  is_running      BOOLEAN NOT NULL DEFAULT FALSE
);
INSERT INTO wiki_agent_state (kind) VALUES ('tables'), ('docs'), ('code')
  ON CONFLICT DO NOTHING;

-- ─── SME personas (user-creatable, teach-only) ──────────────────────────
-- The six built-in personas (Marcus, IRIS, etc.) live in
-- frontend/src/features/situation_room/fixtures.ts. Rows in this table are
-- ADDITIONAL personas the user creates from the UI. They have no auto-
-- probe today — they start in 'watching' state and rely entirely on the
-- Teach panel for institutional knowledge until a probe is bound to them.

CREATE TABLE IF NOT EXISTS sme_personas (
  id          TEXT PRIMARY KEY,                  -- lowercase slug
  name        TEXT NOT NULL,
  role        TEXT NOT NULL,
  icon        TEXT NOT NULL DEFAULT 'settings-cog',
  color_bg    TEXT NOT NULL DEFAULT '#F1EFE8',
  color_fg    TEXT NOT NULL DEFAULT '#5F5E5A',
  domain      TEXT[] NOT NULL DEFAULT '{}',
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  TEXT NOT NULL DEFAULT 'user',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── SME calibration (Phase 3) ──────────────────────────────────────────
-- Per-meeting thumbs from the user. We aggregate over a rolling window to
-- show "<SME> · 84% useful over 47 cases" on the card hover and the
-- meeting footer. One row per (sme, decision) pair so duplicates upsert.

CREATE TABLE IF NOT EXISTS sme_feedback (
  id            SERIAL PRIMARY KEY,
  sme_id        TEXT NOT NULL,
  decision_slug TEXT NOT NULL,
  rating        SMALLINT NOT NULL CHECK (rating IN (-1, 1)),
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sme_id, decision_slug)
);
CREATE INDEX IF NOT EXISTS sme_feedback_sme_idx ON sme_feedback(sme_id, created_at DESC);

-- ─── SME knowledge (Phase 3 of the Situation Room) ──────────────────────
-- User-authored notes/rules attached to a specific SME persona. Injected
-- verbatim into that SME's deliberation prompt so the model carries
-- domain-specific institutional knowledge into every meeting. Think
-- "Claude memory, but per-persona". Stored unstructured (free text) plus
-- an importance tier 1-5 that biases ordering when there are many notes.

CREATE TABLE IF NOT EXISTS sme_knowledge (
  id          SERIAL PRIMARY KEY,
  sme_id      TEXT NOT NULL,
  text        TEXT NOT NULL,
  importance  INTEGER NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sme_knowledge_sme_idx
  ON sme_knowledge(sme_id, enabled, importance DESC);

-- ─── Decisions ledger (Phase 3 of the Situation Room) ───────────────────
-- Every Standing Meeting we open writes a row here. Each row collects the
-- question, who was convened, what each SME said, and the outcome (open /
-- accepted / closed). The ledger is the system of record for "what did
-- ops decide this shift" — auditable, filterable, immutable past close.

CREATE TABLE IF NOT EXISTS decisions (
  id            SERIAL PRIMARY KEY,
  slug          TEXT UNIQUE NOT NULL,        -- d-<short uuid>
  kind          TEXT NOT NULL CHECK (kind IN ('ad-hoc','briefing','sme')),
  question      TEXT NOT NULL,
  panel         TEXT[] NOT NULL,              -- sme_id list, e.g. {iris,mason}
  context_label TEXT,                         -- "Briefing · IRIS + Mason converging"
  pinned_id     TEXT,                         -- incident.id if it was a briefing
  outcome       TEXT NOT NULL DEFAULT 'open' CHECK (outcome IN ('open','accepted','closed','overridden')),
  accepted_sme  TEXT,                         -- the SME whose finding the user accepted
  override_note TEXT,                         -- if a human overrode the panel
  receipts      JSONB,                        -- per-sme contribution captured at close
  opened_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS decisions_opened_idx ON decisions(opened_at DESC);
CREATE INDEX IF NOT EXISTS decisions_outcome_idx ON decisions(outcome);

-- ─── Audit log (system-wide) ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_log (
  id        SERIAL PRIMARY KEY,
  ts        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor     TEXT NOT NULL,
  action    TEXT NOT NULL,
  target    TEXT,
  details   JSONB
);
CREATE INDEX IF NOT EXISTS audit_ts_idx ON audit_log(ts DESC);
