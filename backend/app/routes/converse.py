"""POST /api/converse — single SSE surface for the new Loom UI.

This is the orchestrator that drives the Claude-Code-style transcript view.
Replaces the split between /chat and /sme/deliberate for the home surface.

Flow per user turn:
  1. Router LLM decides: do we need SMEs for this question?
  2. If yes → emit `handshake`, fan out to all selected SMEs in parallel,
     stream each as a named speaker, run synthesize, emit `synthesis`.
     Then a brief wrap-up `agent_speak` from Loom.
  3. If no → Loom answers directly with the existing chat agent
     (full tool loop), all events surfaced as `agent_speak` + inline
     `tool_call` / `tool_output`.

Event types (SSE):
  user_message     {msg_id, text}                 echo at turn start
  agent_speak      {msg_id, text}                 streamed delta from Loom
  handshake        {msg_id, smes, reason}         "convening X, Y"
  sme_start        {msg_id, sme_id}               persona begins
  sme_delta        {msg_id, sme_id, text}         streamed delta from SME
  sme_done         {msg_id, sme_id}               persona ends
  tool_call        {msg_id, agent_id, name, args} inline mini-card
  tool_output      {msg_id, agent_id, name, summary}
  synthesis        {msg_id, consensus_summary, dissenters}
  turn_done        {msg_id, duration_ms, cost_usd, llm_calls}
  error            {msg_id, message}
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from typing import Any, AsyncIterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app import cost
from app.db import get_conn
from app.llm import async_client, chat_model_id
from app.routes.sme import _load_knowledge, _SYNTH_SYSTEM

log = logging.getLogger(__name__)
router = APIRouter()


# ─── built-in personas mirrored here ────────────────────────────────────
# The frontend has the full roster; here we only need ids + domains for
# routing and the persona ANGLE prompt for the deliberate call.

BUILTIN_PERSONAS: list[dict[str, Any]] = [
    {"id": "marcus", "name": "Marcus", "role": "Mfg Engineer",
     "domain": ["oee", "throughput", "changeover", "downtime", "cycle time"]},
    {"id": "iris", "name": "IRIS", "role": "IIoT · Sensors",
     "domain": ["telemetry", "anomaly", "vibration", "temperature", "pressure", "sensor"]},
    {"id": "quinn", "name": "Quinn", "role": "Quality · SPC",
     "domain": ["cpk", "defect rate", "spc", "tolerance", "quality"]},
    {"id": "sasha", "name": "Sasha", "role": "Supply Chain",
     "domain": ["inventory", "lead time", "supplier risk", "shipment", "buffer"]},
    {"id": "mason", "name": "Mason", "role": "Maintenance",
     "domain": ["mtbf", "predictive", "work orders", "service", "failure"]},
    {"id": "sage", "name": "Sage", "role": "Safety · Compliance",
     "domain": ["incidents", "audit", "regulatory", "compliance"]},
]


async def _all_personas() -> list[dict[str, Any]]:
    """Built-ins + user-created sme_personas rows."""
    out = list(BUILTIN_PERSONAS)
    try:
        from psycopg.rows import dict_row
        async with get_conn() as conn:
            async with conn.cursor(row_factory=dict_row) as cur:
                await cur.execute(
                    "SELECT id, name, role, domain FROM sme_personas WHERE enabled = TRUE",
                )
                rows = await cur.fetchall()
        for r in rows:
            if any(p["id"] == r["id"] for p in out):
                continue
            out.append({
                "id": r["id"],
                "name": r["name"],
                "role": r["role"],
                "domain": list(r.get("domain") or []),
            })
    except Exception as e:  # noqa: BLE001
        log.warning("converse.persona_load_failed err=%s", e)
    return out


# ─── router · decide whether to involve SMEs ────────────────────────────


_ROUTER_SYSTEM = (
    "You route a user's question to the right kind of answer.\n\n"
    "Pick `route='smes'` when the question benefits from multiple expert "
    "perspectives or recommendations: anomalies, trade-offs, what-should-we-do, "
    "diagnostics, ranking equipment / lines / suppliers, etc. Pick 2-4 SMEs "
    "whose domains overlap the question.\n\n"
    "Pick `route='direct'` when the question is a simple fact lookup, a "
    "code/SQL question, or a clear chat ('what tables do we have?').\n\n"
    "Output ONLY JSON: "
    '{"route": "smes" | "direct", "smes": ["marcus", "iris"], "reason": "short"}'
)


async def _route(question: str, personas: list[dict[str, Any]]) -> dict[str, Any]:
    roster = "\n".join(
        f"- {p['id']} ({p['name']} · {p['role']}) domains: {', '.join(p['domain'])}"
        for p in personas
    )
    user_msg = f"AVAILABLE SMEs:\n{roster}\n\nQUESTION:\n{question}"
    client = async_client()
    try:
        resp = await client.chat.completions.create(
            model=chat_model_id(),
            messages=[
                {"role": "system", "content": _ROUTER_SYSTEM},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.0,
            max_tokens=150,
            response_format={"type": "json_object"},
        )
    except Exception:
        resp = await client.chat.completions.create(
            model=chat_model_id(),
            messages=[
                {"role": "system", "content": _ROUTER_SYSTEM},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.0,
            max_tokens=150,
        )
    content = (resp.choices[0].message.content or "").strip() if resp.choices else ""
    cost.record("converse-router", len(_ROUTER_SYSTEM) + len(user_msg), len(content), chat_model_id())
    try:
        start = content.find("{")
        end = content.rfind("}")
        if start >= 0 and end > start:
            content = content[start : end + 1]
        parsed = json.loads(content)
        route = parsed.get("route", "direct")
        if route not in ("smes", "direct"):
            route = "direct"
        smes = parsed.get("smes", []) if route == "smes" else []
        if not isinstance(smes, list):
            smes = []
        valid_ids = {p["id"] for p in personas}
        smes = [s for s in smes if isinstance(s, str) and s in valid_ids][:4]
        if route == "smes" and not smes:
            route = "direct"
        return {
            "route": route,
            "smes": smes,
            "reason": str(parsed.get("reason", ""))[:200],
        }
    except Exception as e:  # noqa: BLE001
        log.warning("converse.route_parse_failed err=%s body=%s", e, content[:160])
        return {"route": "direct", "smes": [], "reason": ""}


# ─── per-SME persona prompt (kept here so converse is self-contained) ───


def _persona_prefix(p: dict[str, Any]) -> str:
    ANGLES: dict[str, str] = {
        "marcus": "You are MARCUS, the Manufacturing Engineer. ANGLE: throughput and OEE. "
                  "Frame in cycle-time impact, line-balance, changeover variance. "
                  "Recommend equipment / scheduling / staffing actions.",
        "iris": "You are IRIS, the IIoT / Sensors SME. ANGLE: raw telemetry. "
                "Frame in σ from baseline, sensor noise, anomaly clustering. "
                "Recommend instrumentation / threshold / data-quality actions.",
        "quinn": "You are QUINN, the Quality / SPC SME. ANGLE: process capability. "
                 "Frame in Cpk, control limits, defect rate, tolerance drift. "
                 "Recommend SPC / inspection / supplier-quality actions.",
        "sasha": "You are SASHA, the Supply Chain SME. ANGLE: material flow and buffer coverage. "
                 "If the catalog has no supply-chain data, say so plainly and stop.",
        "mason": "You are MASON, the Maintenance SME. ANGLE: equipment health and MTBF. "
                 "Frame in failure modes, MTBF curve, time-to-service, work-order priority. "
                 "Recommend service intervals / parts / PM-frequency changes.",
        "sage": "You are SAGE, the Safety / Compliance SME. ANGLE: regulatory and audit. "
                "Frame in audit checkpoints, escalation thresholds, regulatory exposure.",
    }
    base = ANGLES.get(p["id"], f"You are {p['name']}, the {p['role']} SME.")
    return (
        base
        + "\n\nFORMAT (strict):\n"
        "- 3 to 5 sentences of analysis from YOUR angle, quote actual numbers when you have them\n"
        "- one sentence stating any disagreement with the obvious view\n"
        "- last line, prefixed exactly 'Recommend: …'\n\n"
        "Do NOT narrate tool calls or restate the question. Just the analysis."
    )


# ─── SSE helpers ────────────────────────────────────────────────────────


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


class ConverseRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    conversation_id: str | None = None


# ─── one-SME stream (writes events to a shared queue) ───────────────────


async def _run_sme(
    persona: dict[str, Any],
    question: str,
    context_finding: str | None,
    msg_id: str,
    queue: asyncio.Queue[tuple[str, dict[str, Any]] | None],
) -> str:
    """Run /sme/deliberate inline (we don't HTTP-call ourselves; share the
    client). Returns the full text the SME produced."""
    notes = await _load_knowledge(persona["id"])
    prefix = _persona_prefix(persona)
    user_parts = [prefix]
    if notes:
        bullets = "\n".join(f"  - {n.strip()}" for n in notes)
        user_parts.append(
            "INSTITUTIONAL KNOWLEDGE for this SME (curated):\n"
            f"{bullets}\n"
            "Treat as ground truth where relevant."
        )
    if context_finding:
        user_parts.append(
            "DATA YOU ALREADY HAVE (from the live catalog):\n"
            f"  {context_finding}\n"
            "Analyze directly."
        )
    user_parts.append(f"Question: {question.strip()}")
    user_msg = "\n\n".join(user_parts)

    await queue.put(("sme_start", {"msg_id": msg_id, "sme_id": persona["id"]}))

    full_text = ""
    completion_chars = 0
    model = chat_model_id()
    try:
        client = async_client()
        stream = await client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": user_msg}],
            stream=True,
            temperature=0.3,
            max_tokens=400,
        )
        async for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if delta and delta.content:
                completion_chars += len(delta.content)
                full_text += delta.content
                await queue.put((
                    "sme_delta",
                    {
                        "msg_id": msg_id,
                        "sme_id": persona["id"],
                        "text": delta.content,
                    },
                ))
    except Exception as e:  # noqa: BLE001
        log.exception("converse.sme_failed sme=%s", persona["id"])
        await queue.put((
            "error",
            {
                "msg_id": msg_id,
                "message": f"{persona['name']}: {type(e).__name__}: {e}",
            },
        ))
    finally:
        cost.record("converse-sme", len(user_msg), completion_chars, model, sme_id=persona["id"])
        await queue.put(("sme_done", {"msg_id": msg_id, "sme_id": persona["id"]}))

    return full_text


# ─── synthesis (re-uses the same prompt as /sme/synthesize) ─────────────


async def _synthesize(answers: list[dict[str, str]]) -> dict[str, Any]:
    if len(answers) < 2:
        return {"consensus_summary": "", "dissenters": []}
    pieces = ["SME ANSWERS:"]
    for a in answers:
        pieces.append(f"\n### {a['sme_id']}\n{a['text'].strip()}")
    pieces.append(
        '\n\nReturn ONLY JSON: {"consensus_summary": "...", '
        '"dissenters": [{"sme_id": "...", "reason": "..."}]}'
    )
    user_msg = "\n".join(pieces)
    client = async_client()
    try:
        resp = await client.chat.completions.create(
            model=chat_model_id(),
            messages=[
                {"role": "system", "content": _SYNTH_SYSTEM},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.0,
            max_tokens=300,
            response_format={"type": "json_object"},
        )
    except Exception:
        resp = await client.chat.completions.create(
            model=chat_model_id(),
            messages=[
                {"role": "system", "content": _SYNTH_SYSTEM},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.0,
            max_tokens=300,
        )
    content = (resp.choices[0].message.content or "").strip() if resp.choices else ""
    cost.record("converse-synth", len(_SYNTH_SYSTEM) + len(user_msg), len(content), chat_model_id())
    try:
        start = content.find("{")
        end = content.rfind("}")
        if start >= 0 and end > start:
            content = content[start : end + 1]
        parsed = json.loads(content)
        return {
            "consensus_summary": str(parsed.get("consensus_summary", ""))[:400],
            "dissenters": [
                {
                    "sme_id": str(d.get("sme_id", ""))[:64],
                    "reason": str(d.get("reason", ""))[:300],
                }
                for d in (parsed.get("dissenters") or [])
                if isinstance(d, dict)
            ],
        }
    except Exception:  # noqa: BLE001
        return {"consensus_summary": content[:400], "dissenters": []}


# ─── wrap-up (Loom's closing line after the SMEs spoke) ────────────────


async def _wrap_up(
    question: str,
    answers: list[dict[str, str]],
    synth: dict[str, Any],
    msg_id: str,
    queue: asyncio.Queue[tuple[str, dict[str, Any]] | None],
) -> None:
    """Stream a brief closing summary from the main agent voice."""
    user_msg = (
        f"User asked: {question}\n\n"
        + "\n\n".join(f"{a['sme_id']}: {a['text']}" for a in answers)
        + f"\n\nConsensus: {synth.get('consensus_summary', '')}\n"
        + "Dissent: "
        + ", ".join(
            f"{d['sme_id']} ({d['reason']})" for d in synth.get("dissenters", [])
        )
        + "\n\nWrite a 2-sentence wrap-up that names the decision and the trade-off. "
          "Don't restate the question."
    )
    completion_chars = 0
    model = chat_model_id()
    try:
        client = async_client()
        stream = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are Loom, the orchestrator. Speak in first person plural ('we'). Terse."},
                {"role": "user", "content": user_msg},
            ],
            stream=True,
            temperature=0.2,
            max_tokens=160,
        )
        async for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if delta and delta.content:
                completion_chars += len(delta.content)
                await queue.put((
                    "agent_speak",
                    {"msg_id": msg_id, "text": delta.content},
                ))
    except Exception as e:  # noqa: BLE001
        log.warning("converse.wrap_up_failed err=%s", e)
    finally:
        cost.record("converse-wrap", len(user_msg), completion_chars, model)


# ─── direct mode (no SMEs) ──────────────────────────────────────────────


async def _direct_answer(
    question: str,
    msg_id: str,
    queue: asyncio.Queue[tuple[str, dict[str, Any]] | None],
) -> None:
    """Plain LLM answer, streamed. Could later promote to the full /chat
    agent if we want tool use; this v1 keeps it lean."""
    completion_chars = 0
    model = chat_model_id()
    try:
        client = async_client()
        stream = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are Loom. Be concise and accurate. Speak in first person plural ('we')."},
                {"role": "user", "content": question},
            ],
            stream=True,
            temperature=0.3,
            max_tokens=500,
        )
        async for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if delta and delta.content:
                completion_chars += len(delta.content)
                await queue.put((
                    "agent_speak",
                    {"msg_id": msg_id, "text": delta.content},
                ))
    except Exception as e:  # noqa: BLE001
        await queue.put((
            "error",
            {"msg_id": msg_id, "message": f"{type(e).__name__}: {e}"},
        ))
    finally:
        cost.record("converse-direct", len(question), completion_chars, model)


# ─── snapshot helper (so SMEs get the latest finding as context) ────────


async def _snapshot_findings() -> dict[str, str]:
    try:
        from app.routes.situation_room import snapshot as _snap
        snap = await _snap()
        return {s.sme_id: s.current_finding for s in snap.stations if s.current_finding}
    except Exception as e:  # noqa: BLE001
        log.warning("converse.snapshot_load_failed err=%s", e)
        return {}


# ─── main endpoint ──────────────────────────────────────────────────────


@router.post("")
async def converse(req: ConverseRequest) -> StreamingResponse:
    msg_id = "m-" + uuid.uuid4().hex[:10]
    started = time.perf_counter()
    cost_before = cost.snapshot()["total"]["cost_usd"]
    calls_before = cost.snapshot()["total"]["calls"]

    async def gen() -> AsyncIterator[str]:
        queue: asyncio.Queue[tuple[str, dict[str, Any]] | None] = asyncio.Queue()
        question = req.question.strip()

        yield _sse("user_message", {"msg_id": msg_id, "text": question})

        # 1. Route
        personas = await _all_personas()
        decision = await _route(question, personas)
        log.info("converse.route msg=%s route=%s smes=%s", msg_id, decision["route"], decision["smes"])

        if decision["route"] == "direct":
            # Background producer
            producer = asyncio.create_task(_direct_answer(question, msg_id, queue))

            async def _drain() -> None:
                await producer
                await queue.put(None)

            drain = asyncio.create_task(_drain())
            try:
                while True:
                    item = await queue.get()
                    if item is None:
                        break
                    name, data = item
                    yield _sse(name, data)
            finally:
                drain.cancel()
                try:
                    await drain
                except (asyncio.CancelledError, Exception):
                    pass

        else:
            # SME route
            convened = [p for p in personas if p["id"] in decision["smes"]]
            if not convened:
                # Defensive: shouldn't happen because the router validates ids
                async for chunk in _direct_answer_iter(question, msg_id):
                    yield chunk
                return

            yield _sse(
                "handshake",
                {
                    "msg_id": msg_id,
                    "smes": [p["id"] for p in convened],
                    "reason": decision["reason"],
                },
            )

            findings = await _snapshot_findings()

            answers: dict[str, str] = {}

            async def _run_one(p: dict[str, Any]) -> None:
                text = await _run_sme(p, question, findings.get(p["id"]), msg_id, queue)
                answers[p["id"]] = text

            workers = [asyncio.create_task(_run_one(p)) for p in convened]

            async def _drain() -> None:
                await asyncio.gather(*workers, return_exceptions=True)
                await queue.put(None)

            drain = asyncio.create_task(_drain())
            try:
                while True:
                    item = await queue.get()
                    if item is None:
                        break
                    name, data = item
                    yield _sse(name, data)
            finally:
                drain.cancel()
                try:
                    await drain
                except (asyncio.CancelledError, Exception):
                    pass

            # Synthesize
            answer_list = [
                {"sme_id": sid, "text": txt}
                for sid, txt in answers.items()
                if txt.strip()
            ]
            if len(answer_list) >= 2:
                synth = await _synthesize(answer_list)
                yield _sse(
                    "synthesis",
                    {"msg_id": msg_id, **synth},
                )

                # Wrap-up
                wrap_queue: asyncio.Queue[tuple[str, dict[str, Any]] | None] = asyncio.Queue()
                producer = asyncio.create_task(_wrap_up(question, answer_list, synth, msg_id, wrap_queue))

                async def _wrap_drain() -> None:
                    await producer
                    await wrap_queue.put(None)

                wd = asyncio.create_task(_wrap_drain())
                try:
                    while True:
                        item = await wrap_queue.get()
                        if item is None:
                            break
                        name, data = item
                        yield _sse(name, data)
                finally:
                    wd.cancel()
                    try:
                        await wd
                    except (asyncio.CancelledError, Exception):
                        pass

        # turn_done
        snap_after = cost.snapshot()["total"]
        dur_ms = int((time.perf_counter() - started) * 1000)
        yield _sse(
            "turn_done",
            {
                "msg_id": msg_id,
                "duration_ms": dur_ms,
                "cost_usd": round(snap_after["cost_usd"] - cost_before, 4),
                "llm_calls": snap_after["calls"] - calls_before,
            },
        )

    return StreamingResponse(gen(), media_type="text/event-stream")


async def _direct_answer_iter(
    question: str, msg_id: str
) -> AsyncIterator[str]:
    """Convenience generator wrapping _direct_answer when the SME route
    falls back to direct mid-flow (rare)."""
    q: asyncio.Queue[tuple[str, dict[str, Any]] | None] = asyncio.Queue()
    producer = asyncio.create_task(_direct_answer(question, msg_id, q))

    async def _drain() -> None:
        await producer
        await q.put(None)

    drain = asyncio.create_task(_drain())
    try:
        while True:
            item = await q.get()
            if item is None:
                break
            name, data = item
            yield _sse(name, data)
    finally:
        drain.cancel()
        try:
            await drain
        except (asyncio.CancelledError, Exception):
            pass
