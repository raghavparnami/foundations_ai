"""SME endpoints:
  POST /api/sme/deliberate                — fast-lane LLM (no tools)
  GET  /api/sme/{sme_id}/knowledge        — list this SME's notes
  POST /api/sme/{sme_id}/knowledge        — add a note
  PATCH /api/sme/knowledge/{id}           — toggle enabled / edit text
  DELETE /api/sme/knowledge/{id}          — remove a note

POST /api/sme/deliberate — fast lane for Standing Meeting columns.

The default /api/chat runs the full Loom agent loop (plan → wiki tools →
DB tools → answer). For a Standing Meeting column we don't need any of
that — the snapshot endpoint already extracted the SME's current finding
from the real catalog, and the column just needs the LLM to ANALYZE
that finding through the persona's lens.

This route does a single streaming LLM completion. No tools, no rounds.
Latency drops from ~30s/column to ~3-8s.

Caller passes:
  - sme_id           which persona is talking (used to log)
  - question         the user's question (or the briefing headline)
  - persona_prompt   the full angle + format block (built client-side)
  - context_finding  the relevant data point from the SR snapshot (optional)

Streams SSE in the same shape as /api/chat:
  event: delta\\ndata: {"text": "..."}
  event: done\\ndata: {}
  event: error\\ndata: {"message": "..."}
"""
from __future__ import annotations

import json
import logging
from typing import AsyncIterator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from psycopg.rows import dict_row
from pydantic import BaseModel, Field

from app.db import get_conn
from app.llm import async_client, chat_model_id

log = logging.getLogger(__name__)
router = APIRouter()


class DeliberateRequest(BaseModel):
    sme_id: str
    question: str = Field(min_length=1)
    persona_prompt: str = Field(min_length=10)
    context_finding: str | None = None


class KnowledgeIn(BaseModel):
    text: str = Field(min_length=2, max_length=500)
    importance: int = Field(default=3, ge=1, le=5)


class KnowledgePatch(BaseModel):
    text: str | None = Field(default=None, max_length=500)
    importance: int | None = Field(default=None, ge=1, le=5)
    enabled: bool | None = None


class KnowledgeOut(BaseModel):
    id: int
    sme_id: str
    text: str
    importance: int
    enabled: bool
    created_at: str
    updated_at: str


async def _load_knowledge(sme_id: str) -> list[str]:
    """Return enabled notes for this SME, sorted by importance DESC."""
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT text FROM sme_knowledge "
                " WHERE sme_id = %s AND enabled = TRUE "
                " ORDER BY importance DESC, id ASC LIMIT 20",
                (sme_id,),
            )
            rows = await cur.fetchall()
    return [r[0] for r in rows]


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _build_messages(req: DeliberateRequest, notes: list[str]) -> list[dict]:
    user_parts = [req.persona_prompt.strip()]
    if notes:
        bullets = "\n".join(f"  - {n.strip()}" for n in notes)
        user_parts.append(
            "INSTITUTIONAL KNOWLEDGE for this SME (curated by your team):\n"
            f"{bullets}\n"
            "Treat these as ground truth and apply them when relevant."
        )
    if req.context_finding:
        user_parts.append(
            "DATA YOU ALREADY HAVE (from the live catalog):\n"
            f"  {req.context_finding}\n"
            "You don't need to look anything else up — analyze this directly."
        )
    user_parts.append(f"Question: {req.question.strip()}")
    return [{"role": "user", "content": "\n\n".join(user_parts)}]


@router.post("/deliberate")
async def deliberate(req: DeliberateRequest) -> StreamingResponse:
    notes = await _load_knowledge(req.sme_id)
    messages = _build_messages(req, notes)

    async def gen() -> AsyncIterator[str]:
        try:
            client = async_client()
            stream = await client.chat.completions.create(
                model=chat_model_id(),
                messages=messages,
                stream=True,
                temperature=0.3,
                max_tokens=400,  # keep it terse — 3-5 sentences + recommend
            )
            async for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                if delta and delta.content:
                    yield _sse("delta", {"text": delta.content})
            yield _sse("done", {})
        except Exception as e:  # noqa: BLE001
            log.exception("sme.deliberate failed sme=%s", req.sme_id)
            yield _sse(
                "error",
                {"message": f"{type(e).__name__}: {e}"},
            )

    return StreamingResponse(gen(), media_type="text/event-stream")


# ─── SME knowledge CRUD ──────────────────────────────────────────────────


def _row_to_out(r: dict) -> KnowledgeOut:
    return KnowledgeOut(
        id=r["id"],
        sme_id=r["sme_id"],
        text=r["text"],
        importance=r["importance"],
        enabled=r["enabled"],
        created_at=r["created_at"].isoformat(),
        updated_at=r["updated_at"].isoformat(),
    )


@router.get("/{sme_id}/knowledge", response_model=list[KnowledgeOut])
async def list_knowledge(sme_id: str) -> list[KnowledgeOut]:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                "SELECT id, sme_id, text, importance, enabled, created_at, updated_at "
                "  FROM sme_knowledge WHERE sme_id = %s "
                " ORDER BY enabled DESC, importance DESC, id DESC",
                (sme_id,),
            )
            rows = await cur.fetchall()
    return [_row_to_out(r) for r in rows]


@router.post("/{sme_id}/knowledge", response_model=KnowledgeOut)
async def add_knowledge(sme_id: str, body: KnowledgeIn) -> KnowledgeOut:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                "INSERT INTO sme_knowledge (sme_id, text, importance) "
                "VALUES (%s, %s, %s) "
                "RETURNING id, sme_id, text, importance, enabled, created_at, updated_at",
                (sme_id, body.text.strip(), body.importance),
            )
            r = await cur.fetchone()
    if r is None:
        raise HTTPException(500, "insert failed")
    return _row_to_out(r)


@router.patch("/knowledge/{kid}", response_model=KnowledgeOut)
async def patch_knowledge(kid: int, body: KnowledgePatch) -> KnowledgeOut:
    sets: list[str] = []
    args: list[object] = []
    if body.text is not None:
        sets.append("text = %s")
        args.append(body.text.strip())
    if body.importance is not None:
        sets.append("importance = %s")
        args.append(body.importance)
    if body.enabled is not None:
        sets.append("enabled = %s")
        args.append(body.enabled)
    if not sets:
        raise HTTPException(400, "no fields to update")
    sets.append("updated_at = NOW()")
    args.append(kid)
    sql = (
        "UPDATE sme_knowledge SET " + ", ".join(sets) +
        " WHERE id = %s "
        " RETURNING id, sme_id, text, importance, enabled, created_at, updated_at"
    )
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(sql, tuple(args))
            r = await cur.fetchone()
    if r is None:
        raise HTTPException(404, "knowledge id not found")
    return _row_to_out(r)


@router.delete("/knowledge/{kid}", status_code=204)
async def delete_knowledge(kid: int) -> None:
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute("DELETE FROM sme_knowledge WHERE id = %s", (kid,))
