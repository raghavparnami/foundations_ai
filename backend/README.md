# Loom backend (Python / FastAPI)

This is the v0.5 rewrite of the Loom backend. It runs **side-by-side** with the
legacy Next.js app under `/Users/raghavparnami/loom/src` — both read and write
to the same Postgres database (`loom_catalog`, schema `foundation_ai`). Cutover
will be a single env-var flip in the new React frontend pointing
`VITE_API_URL` from the Next.js port to this one.

Vertical 1 ports only the Connections page (`GET/POST /api/connections` +
`POST /api/connections/inspect`). Other verticals are queued — see
`docs/plans/v0.5-python-react.md`.

## Hard rules

- Do not modify anything under `loom/src/` — the old app must keep working.
- Do not modify the Postgres schema — both apps share `foundation_ai.*`.
- Only outbound network calls allowed (in future verticals): OpenRouter and
  `python-gitlab`. **Vertical 1 (this slice) is pure Postgres — no LLM, no
  external HTTP.**
- No telemetry libraries.
- Run on port **8001** (Next.js uses 3001, Vite uses 5173).
- `NEXT_TELEMETRY_DISABLED=1` should also be set in the parent `.env.local`
  (tracked separately).

## Setup

```bash
cd /Users/raghavparnami/loom/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
cp .env.example .env   # then edit as needed
```

## Run

```bash
uvicorn app.main:app --reload --port 8001
```

Smoke test:

```bash
curl -s http://localhost:8001/healthz
# {"ok": true, "search_path": "foundation_ai, public"}

curl -s http://localhost:8001/api/connections
# {"sources": [{"id": 1, "name": "factory_demo", ...}]}

curl -s -X POST http://localhost:8001/api/connections/inspect \
     -H 'Content-Type: application/json' \
     -d '{"conn_url":"postgres://loom:loom@localhost:5544/loom_demo_source"}'
# {"ok": true, "schemas": [...]}
```

## Layout

```
backend/
├── pyproject.toml
├── .env.example
├── README.md
└── app/
    ├── __init__.py
    ├── main.py             FastAPI entry + CORS + lifespan + /healthz
    ├── config.py           pydantic-settings (LOOM_CATALOG_URL, ...)
    ├── db.py               psycopg_pool over loom_catalog (search_path set)
    └── routes/
        ├── __init__.py
        └── connections.py  GET/POST /api/connections + /inspect
```
