# Deploy on Railway

Two Railway services (backend + frontend) sharing one Railway Postgres.

## 0. Provision

In Railway:
1. **New project** → name it however you want
2. Inside it: **+ New → Database → PostgreSQL** (this gives you `DATABASE_URL` for free, and the pgvector extension is preinstalled).
3. **+ New → GitHub Repo → your fork of this repo** twice — once each for `backend/` and `frontend/`. Pin **Root Directory** in each service's settings:
   - Backend service root = `backend/`
   - Frontend service root = `frontend/`

## 1. Apply Loom's schema to Railway Postgres

From your laptop (one time):

```bash
export RAILWAY_URL='<copy DATABASE_URL from Railway → Postgres → Variables>'
psql "$RAILWAY_URL" -f setup/sql/01-loom-catalog-schema.sql
# Optional: seed the manufacturing demo data too
psql "$RAILWAY_URL" -f setup/seed/manufacturing.sql
```

Or, if you have existing local data you want to keep:

```bash
export RAILWAY_URL='<...>'
export LOCAL_URL='postgres://loom:loom@localhost:5544/loom_catalog'
bash setup/migrate-to-railway.sh
```

## 2. Backend service env vars

In Railway → **Backend service** → Variables:

| Key | Value | Notes |
|---|---|---|
| `DATABASE_URL` | _(auto-injected if you reference Postgres)_ | Loom reads this as the catalog DB |
| `LOOM_DEMO_SOURCE_URL` | Same `DATABASE_URL` for demo, or your own source DB URL | The source warehouse Loom queries |
| `LLM_PROVIDER` | `openrouter` or `databricks` | |
| `OPENROUTER_API_KEY` | (required if `LLM_PROVIDER=openrouter`) | https://openrouter.ai/keys |
| `OPENROUTER_MODEL` | `deepseek/deepseek-chat-v3.1` | Default |
| `DATABRICKS_HOST` / `DATABRICKS_TOKEN` / `DATABRICKS_MODEL` | (required if `LLM_PROVIDER=databricks`) | |
| `OPENAI_API_KEY` | (optional) | Enables embeddings → semantic retrieval |
| `CORS_ORIGINS` | The frontend's Railway URL, e.g. `https://loom-frontend.up.railway.app` | Comma-separated for multiple |

**Build/start**: Railway auto-detects Python from `pyproject.toml`. The included `backend/Procfile` runs `uvicorn app.main:app --host 0.0.0.0 --port $PORT --no-access-log`.

## 3. Frontend service env vars

In Railway → **Frontend service** → Variables:

| Key | Value | Notes |
|---|---|---|
| `VITE_API_BASE_URL` | The backend's Railway URL, e.g. `https://loom-backend.up.railway.app` | Set this BEFORE the first build — Vite bakes env vars in at build time |

**Build/start**: Railway runs `npm install && npm run build`. The included `frontend/Procfile` then serves the build via `npm run preview -- --host 0.0.0.0 --port $PORT`.

> Tip: if Railway doesn't auto-build, set Build Command = `npm install && npm run build` in the service settings.

## 4. After both deploy

1. **Set CORS** — add the frontend's Railway URL to the backend's `CORS_ORIGINS` and redeploy
2. Open the frontend's Railway URL — the home page hits `/api/ensure-setup` automatically which kicks the scheduler + initial Loop 1/2
3. Watch the agent narrate as it crawls + indexes; chat goes live as soon as any table reports `status='ready'`

## 5. Cost ballpark

- Backend (FastAPI): ~256MB RAM idle, ~$5–10/mo
- Frontend (Vite preview): ~128MB, ~$3–5/mo
- Postgres (catalog only): ~1GB at full population, ~$5/mo
- LLM: per OpenRouter pricing — DeepSeek v3.1 is ~$0.27 / 1M tokens (very cheap; a chat turn is ~$0.001)

## Data hosting tradeoffs

| DB | Where | Why |
|---|---|---|
| `loom_catalog` (foundation_ai.*) | **Railway Postgres** | Needs pgvector; close to backend = lower latency on every chat turn |
| Source warehouses | **In-house OK** | Loom only reads via SELECT — WAN latency tolerable. Open the firewall to Railway's egress IPs, or use a Tailscale/Cloudflare Tunnel sidecar |

You don't have to move source DBs to Railway. Only the catalog needs to be close.
