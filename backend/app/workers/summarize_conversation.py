"""Per-conversation short-term memory.

Port of src/lib/worker/summarize-conversation.ts. Condenses older turns into
a one-paragraph summary on conversations.summary_md so long chats survive
token compaction. Triggered fire-and-forget after each agent turn; only
re-runs when total messages grew by TRIGGER_EVERY since the last summary.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from psycopg.rows import dict_row

from ..catalog.memories import set_conversation_summary
from ..db import get_conn
from ..llm import async_client, chat_model_id

log = logging.getLogger(__name__)

_TRIGGER_EVERY = 4

SYSTEM = """You are summarizing the older portion of a chat between a
data analyst (the user) and an AI agent (Loom) so the agent can carry
forward context without re-reading every old message.

Write ONE compact Markdown paragraph (max ~120 words) covering:
- What the user is investigating (their goal in this chat)
- Key decisions / constraints they've established
- Tables, views, skills, or domains the agent has used so far
- Open threads that may need follow-up

Be terse. Use specifics from the messages, not generic phrases. Skip
greetings, acknowledgements, and tool-call mechanics."""


async def maybe_summarize_conversation(slug: str) -> None:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT
                  (SELECT count(*)::int FROM messages WHERE conversation_id = %s) AS total,
                  COALESCE(c.summarized_turn_count, 0) AS last_summarized
                  FROM conversations c WHERE c.slug = %s
                """,
                (slug, slug),
            )
            row = await cur.fetchone()
    if not row:
        return
    total = int(row["total"] or 0)
    last = int(row["last_summarized"] or 0)
    if total - last < _TRIGGER_EVERY:
        return

    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT role, parts, ord
                  FROM messages
                 WHERE conversation_id = %s
                 ORDER BY ord ASC
                """,
                (slug,),
            )
            messages = await cur.fetchall()
    if not messages:
        return

    transcript = "\n\n".join(
        f"### {m['role'].upper()}\n{_extract_text(m['parts'])}" for m in messages
    )
    if len(transcript) < 200:
        return

    try:
        resp = await async_client().chat.completions.create(
            model=chat_model_id(),
            messages=[
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": transcript[:18_000]},
            ],
            temperature=0.2,
        )
        text = (resp.choices[0].message.content or "").strip() if resp.choices else ""
    except Exception as e:  # noqa: BLE001
        log.warning("conv_summary.failed slug=%s err=%s", slug, e)
        return
    if not text:
        return
    await set_conversation_summary(slug, text, total)
    log.info("conv_summary.updated slug=%s turn_count=%s bytes=%s", slug, total, len(text))


def _extract_text(parts: Any) -> str:
    if not isinstance(parts, list):
        return ""
    out: list[str] = []
    for p in parts:
        if not isinstance(p, dict):
            continue
        t = p.get("type")
        if t == "text" and isinstance(p.get("text"), str):
            out.append(p["text"])
        elif isinstance(t, str) and t.startswith("tool-"):
            name = t.removeprefix("tool-")
            output = p.get("output")
            tail = f": {json.dumps(output)[:200]}" if output is not None else ""
            out.append(f"[tool {name}{tail}]")
    return "\n".join(out)
