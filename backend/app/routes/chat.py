"""SSE chat route.

POST /api/chat with a JSON body
    { "messages": [...], "conversation_id": "c-..." }

Returns a stream of `event: <kind>\\ndata: <json>\\n\\n` chunks. Side effects:
  - ensures a `conversations` row exists for the slug (so the sidebar
    History list picks it up)
  - persists the user's most-recent message before invoking the agent
  - persists the assistant's full reply (text + tool parts) when the
    stream finishes

Event kinds:
    tool_start  { id, name, args }
    tool_output { id, name, output }
    delta       { text }
    done        {}
    error       { message }
"""
from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Literal

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.agent.run import run_agent
from app.catalog.messages import ensure_conversation, persist_message

router = APIRouter()
log = logging.getLogger(__name__)


class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system", "tool"]
    content: str = ""
    tool_call_id: str | None = None
    name: str | None = None


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1)
    conversation_id: str | None = None


@router.post("")
async def chat(req: ChatRequest) -> StreamingResponse:
    history: list[dict[str, Any]] = [m.model_dump(exclude_none=True) for m in req.messages]
    slug = (req.conversation_id or "").strip() or f"c-{uuid.uuid4().hex[:12]}"

    # Make sure the conversation row exists. Title = first user message (slice).
    first_user = next(
        (m for m in req.messages if m.role == "user" and m.content.strip()), None,
    )
    title = (first_user.content if first_user else "New conversation")[:80]
    await ensure_conversation(slug, title)

    # Persist the latest user message before invoking the model.
    latest_user = next(
        (m for m in reversed(req.messages) if m.role == "user" and m.content.strip()),
        None,
    )
    if latest_user:
        try:
            await persist_message(
                slug,
                message_id=None,
                role="user",
                parts=[{"type": "text", "text": latest_user.content}],
            )
        except Exception as e:  # noqa: BLE001
            log.warning("chat.persist_user_failed slug=%s err=%s", slug, e)

    async def stream() -> Any:
        # Accumulate the assistant's parts as we stream so we can save them
        # at the end. Mirrors the AI-SDK v6 UIMessage parts shape so the
        # legacy /api/conversations/{slug}/messages GET endpoint round-trips.
        parts: list[dict[str, Any]] = []
        tool_buffer: dict[str, dict[str, Any]] = {}
        text_buffer = ""
        try:
            async for chunk in run_agent(history):
                yield chunk
                # Parse the SSE frame to update our shadow state.
                frame = chunk.strip()
                if not frame:
                    continue
                event_name = ""
                data_str = ""
                for line in frame.split("\n"):
                    if line.startswith("event:"):
                        event_name = line[6:].strip()
                    elif line.startswith("data:"):
                        data_str += line[5:].strip()
                try:
                    data = json.loads(data_str) if data_str else {}
                except json.JSONDecodeError:
                    data = {}

                if event_name == "tool_start":
                    tc_id = str(data.get("id") or "")
                    name = str(data.get("name") or "")
                    part = {
                        "type": f"tool-{name}",
                        "toolCallId": tc_id,
                        "state": "input-available",
                        "input": data.get("args") or {},
                    }
                    tool_buffer[tc_id] = part
                    parts.append(part)
                elif event_name == "tool_output":
                    tc_id = str(data.get("id") or "")
                    raw = data.get("output", "")
                    try:
                        out: Any = json.loads(raw) if isinstance(raw, str) else raw
                    except json.JSONDecodeError:
                        out = raw
                    if tc_id in tool_buffer:
                        tool_buffer[tc_id]["state"] = "output-available"
                        tool_buffer[tc_id]["output"] = out
                elif event_name == "delta":
                    text_buffer += str(data.get("text") or "")
        finally:
            if text_buffer.strip():
                parts.append({"type": "text", "text": text_buffer})
            if parts:
                try:
                    await persist_message(
                        slug,
                        message_id=None,
                        role="assistant",
                        parts=parts,
                    )
                except Exception as e:  # noqa: BLE001
                    log.warning("chat.persist_assistant_failed slug=%s err=%s", slug, e)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "X-Conversation-Id": slug,
        },
    )
