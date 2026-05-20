"""Chat agent loop.

Standard OpenAI-style tool-calling loop, terminating when the model returns
a message with no `tool_calls`. The final assistant content is streamed back
to the SSE route as it arrives. Tool-resolution rounds are non-streamed —
we don't ship deltas of tool_call argument JSON; only the final natural-
language answer is streamed.

`run_agent` is an async generator that yields SSE-formatted strings.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, AsyncIterator, cast

from openai.types.chat import (
    ChatCompletionMessageFunctionToolCall,
    ChatCompletionMessageParam,
    ChatCompletionToolParam,
)

from ..llm import async_client, chat_model_id
from .system_prompt import build_system_prompt
from .tools import TOOLS, run_tool

log = logging.getLogger(__name__)

MAX_TOOL_ROUNDS = 20

# Patterns the model occasionally pastes back even when told not to. The UI
# already renders charts and download chips, so any of this text is noise.
_ARTIFACT_PATTERNS: list[re.Pattern[str]] = [
    # Markdown image with /api/ src ([![alt](/api/charts/x)] or ![alt](/api/...))
    re.compile(r"!\[[^\]]*\]\(/api/(?:charts|reports|presentations)/[^)]+\)\s*"),
    # Markdown link to an artifact URL
    re.compile(r"\[[^\]]*\]\(/api/(?:charts|reports|presentations)/[^)]+\)\s*"),
    # Inline-code URL: `/api/charts/...`
    re.compile(r"`/api/(?:charts|reports|presentations)/[^`]+`\s*"),
    # Whole "Access/View/Open ... at: /api/..." line (incl. an optional bold
    # prefix and trailing newline).
    re.compile(
        r"(?:\*\*[^*\n]{0,80}?\*\*\s*[:\-]?\s*)?"
        r"(?:You can\s+)?(?:Access|View|See|Open)[^\n]{0,80}?"
        r"/api/(?:charts|reports|presentations)/[^\s\)`*\n]+\.?[^\n]*\n?",
        re.IGNORECASE,
    ),
    # Bare URL anywhere
    re.compile(r"/api/(?:charts|reports|presentations)/[A-Za-z0-9-_]+(?:/download)?"),
]


class _DeltaScrubber:
    """Strip artifact-URL noise from the streamed assistant text.

    The stream is token-by-token, so a regex match might span chunks. We hold
    back the last HOLD chars of buffered text on every feed; on flush we emit
    the remainder. HOLD must be larger than any single pattern we want to
    catch (URLs + 'Access ... at:' prefix ≈ < 200 chars).
    """

    HOLD = 400

    def __init__(self) -> None:
        self._buf: str = ""

    def feed(self, delta: str) -> str:
        self._buf += delta
        if len(self._buf) <= self.HOLD:
            return ""
        head = self._buf[: -self.HOLD]
        self._buf = self._buf[-self.HOLD :]
        return _scrub_artifacts(head)

    def flush(self) -> str:
        out = self._buf
        self._buf = ""
        return _scrub_artifacts(out)


def _scrub_artifacts(s: str) -> str:
    for pat in _ARTIFACT_PATTERNS:
        s = pat.sub("", s)
    return s


async def run_agent(history: list[dict[str, Any]]) -> AsyncIterator[str]:
    """Yield SSE-formatted lines. The caller wraps them in a StreamingResponse."""
    system = await build_system_prompt()
    messages: list[dict[str, Any]] = [{"role": "system", "content": system}, *history]
    client = async_client()

    for _round in range(MAX_TOOL_ROUNDS):
        # Hard rule: the FIRST tool call of every turn MUST be `plan`. This
        # guarantees the right-side panel populates with the predicted steps
        # before any data tool runs. Subsequent rounds use tool_choice="auto"
        # so the agent picks the next step itself.
        forced_plan = _round == 0
        tool_choice: Any = (
            {"type": "function", "function": {"name": "plan"}}
            if forced_plan
            else "auto"
        )
        resp = await client.chat.completions.create(
            model=chat_model_id(),
            messages=cast(list[ChatCompletionMessageParam], messages),
            tools=cast(list[ChatCompletionToolParam], TOOLS),
            tool_choice=tool_choice,
        )
        if not resp.choices:
            yield _sse_event("error", {"message": "Model returned no choices"})
            return
        msg = resp.choices[0].message

        # If the model is calling tools, execute and loop.
        if msg.tool_calls:
            # Narrow to function-typed calls only; the SDK union also includes
            # custom tool calls which we don't issue, but mypy can't infer that.
            fn_calls: list[ChatCompletionMessageFunctionToolCall] = [
                tc for tc in msg.tool_calls
                if isinstance(tc, ChatCompletionMessageFunctionToolCall)
            ]
            # Stream any preface text the model wrote alongside its tool call
            # so the user sees "I'll check X, then Y..." BEFORE the tools run.
            if msg.content:
                cleaned = _scrub_artifacts(msg.content)
                if cleaned:
                    yield _sse_event("delta", {"text": cleaned})
            assistant_payload: dict[str, Any] = {
                "role": "assistant",
                "content": msg.content or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments,
                        },
                    }
                    for tc in fn_calls
                ],
            }
            messages.append(assistant_payload)

            for tc in fn_calls:
                try:
                    args = json.loads(tc.function.arguments or "{}")
                except json.JSONDecodeError:
                    args = {}
                yield _sse_event(
                    "tool_start",
                    {"id": tc.id, "name": tc.function.name, "args": args},
                )
                result = await run_tool(tc.function.name, args)
                yield _sse_event(
                    "tool_output",
                    {"id": tc.id, "name": tc.function.name, "output": result},
                )
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": result,
                    }
                )
            continue

        # Final assistant turn — re-issue as a streamed request so the user
        # gets token-by-token output. We've already paid the round-trip cost
        # but the stream gives the UX win on long answers.
        messages.append({"role": "assistant", "content": msg.content or ""})
        stream = await client.chat.completions.create(
            model=chat_model_id(),
            messages=cast(list[ChatCompletionMessageParam], messages[:-1]),
            stream=True,
        )
        scrubber = _DeltaScrubber()
        async for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if delta and delta.content:
                out = scrubber.feed(delta.content)
                if out:
                    yield _sse_event("delta", {"text": out})
        tail = scrubber.flush()
        if tail:
            yield _sse_event("delta", {"text": tail})
        yield _sse_event("done", {})
        return

    # Hit the round cap — the model kept calling tools without finalising.
    # Force a tools-disabled final pass so the user gets an answer based on
    # what was gathered, not a bare error.
    log.warning("agent.round_limit_reached rounds=%s", MAX_TOOL_ROUNDS)
    messages.append({
        "role": "user",
        "content": (
            "You've used the maximum tool budget for this turn. Stop calling "
            "tools and write the best final answer you can from what you've "
            "already gathered. If anything is missing, say so explicitly."
        ),
    })
    try:
        final_stream = await client.chat.completions.create(
            model=chat_model_id(),
            messages=cast(list[ChatCompletionMessageParam], messages),
            stream=True,
        )
        scrubber = _DeltaScrubber()
        async for chunk in final_stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if delta and delta.content:
                out = scrubber.feed(delta.content)
                if out:
                    yield _sse_event("delta", {"text": out})
        tail = scrubber.flush()
        if tail:
            yield _sse_event("delta", {"text": tail})
    except Exception as e:  # noqa: BLE001
        yield _sse_event(
            "error",
            {"message": f"Round limit + finaliser failed: {type(e).__name__}: {e}"},
        )
    yield _sse_event("done", {})


def _sse_event(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"
