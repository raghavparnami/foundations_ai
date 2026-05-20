"""FastAPI entry.

Boots the catalog pool, mounts the routes, and configures CORS so the
Vite frontend on :5173 can call us. No trailing-slash redirects — we mount
routers at fully-qualified prefixes (`/api/connections`) and define routes
on `""` so both legacy and new clients can call them without a 307 dance.
"""
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.db import shutdown_pool, show_search_path, startup_pool
from app.llm import chat_model_id, provider_label
from app.routes import (
    catalog,
    chat,
    connections,
    conversations,
    insights,
    llm,
    media,
    memories,
    projects,
    proposals,
    setup,
    skills,
    wiki,
)
from app.workers.scheduler import stop_scheduler


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    await startup_pool()
    try:
        yield
    finally:
        await stop_scheduler()
        await shutdown_pool()


app = FastAPI(
    title="Loom",
    version="0.5.0",
    description="Loom backend — Python/FastAPI. Same Postgres + (later) OpenRouter as v0.4.",
    lifespan=lifespan,
    # Disable the trailing-slash redirect; the React client always calls the
    # canonical path. A 307 round-trip would corrupt POST bodies on some
    # clients.
    redirect_slashes=False,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
async def healthz() -> dict[str, object]:
    """Liveness + search_path + active LLM provider."""
    return {
        "ok": True,
        "search_path": await show_search_path(),
        "llm": {"provider": provider_label(), "model": chat_model_id()},
    }


app.include_router(connections.router, prefix="/api/connections")
app.include_router(llm.router, prefix="/api/llm")
app.include_router(setup.router, prefix="/api/ensure-setup")
app.include_router(chat.router, prefix="/api/chat")
app.include_router(catalog.router, prefix="/api/catalog")
app.include_router(skills.router, prefix="/api/skills")
app.include_router(skills.candidates_router, prefix="/api/skill-candidates")
app.include_router(memories.router, prefix="/api/memories")
app.include_router(conversations.router, prefix="/api/conversations")
app.include_router(projects.router, prefix="/api/projects")
app.include_router(proposals.router, prefix="/api/proposals")
app.include_router(wiki.router, prefix="/api/wiki")
app.include_router(insights.router, prefix="/api/insights")
app.include_router(media.charts_router, prefix="/api/charts")
app.include_router(media.reports_router, prefix="/api/reports")
app.include_router(media.presentations_router, prefix="/api/presentations")
