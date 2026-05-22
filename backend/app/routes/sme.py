"""POST /api/sme/deliberate — fast lane for Standing Meeting columns.

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

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.llm import async_client, chat_model_id

log = logging.getLogger(__name__)
router = APIRouter()


class DeliberateRequest(BaseModel):
    sme_id: str
    question: str = Field(min_length=1)
    persona_prompt: str = Field(min_length=10)
    context_finding: str | None = None


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _build_messages(req: DeliberateRequest) -> list[dict]:
    user_parts = [req.persona_prompt.strip()]
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
    messages = _build_messages(req)

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
