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

from app import cost
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

    prompt_chars = sum(len(m.get("content", "")) for m in messages)
    completion_chars = 0
    model = chat_model_id()

    async def gen() -> AsyncIterator[str]:
        nonlocal completion_chars
        try:
            client = async_client()
            stream = await client.chat.completions.create(
                model=model,
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
                    completion_chars += len(delta.content)
                    yield _sse("delta", {"text": delta.content})
            yield _sse("done", {})
        except Exception as e:  # noqa: BLE001
            log.exception("sme.deliberate failed sme=%s", req.sme_id)
            yield _sse(
                "error",
                {"message": f"{type(e).__name__}: {e}"},
            )
        finally:
            cost.record(
                "sme-deliberate",
                prompt_chars,
                completion_chars,
                model,
                sme_id=req.sme_id,
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


# ─── User-created SME personas ───────────────────────────────────────────


class PersonaIn(BaseModel):
    id: str = Field(min_length=2, max_length=32, pattern=r"^[a-z0-9_-]+$")
    name: str = Field(min_length=1, max_length=40)
    role: str = Field(min_length=1, max_length=60)
    icon: str = Field(default="settings-cog")
    color_bg: str = Field(default="#F1EFE8")
    color_fg: str = Field(default="#5F5E5A")
    domain: list[str] = Field(default_factory=list)


class PersonaOut(BaseModel):
    id: str
    name: str
    role: str
    icon: str
    color_bg: str
    color_fg: str
    domain: list[str]
    enabled: bool
    created_by: str
    created_at: str


def _persona_to_out(r: dict) -> PersonaOut:
    return PersonaOut(
        id=r["id"],
        name=r["name"],
        role=r["role"],
        icon=r["icon"],
        color_bg=r["color_bg"],
        color_fg=r["color_fg"],
        domain=list(r["domain"] or []),
        enabled=r["enabled"],
        created_by=r["created_by"],
        created_at=r["created_at"].isoformat(),
    )


@router.get("/personas", response_model=list[PersonaOut])
async def list_personas() -> list[PersonaOut]:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                "SELECT * FROM sme_personas ORDER BY created_at ASC",
            )
            rows = await cur.fetchall()
    return [_persona_to_out(r) for r in rows]


@router.post("/personas", response_model=PersonaOut)
async def add_persona(body: PersonaIn) -> PersonaOut:
    domain = [d.strip().lower() for d in body.domain if d.strip()]
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                "INSERT INTO sme_personas (id, name, role, icon, color_bg, color_fg, domain) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s) "
                "ON CONFLICT (id) DO NOTHING "
                "RETURNING *",
                (body.id, body.name, body.role, body.icon, body.color_bg, body.color_fg, domain),
            )
            r = await cur.fetchone()
    if r is None:
        raise HTTPException(409, f"persona id '{body.id}' already exists")
    return _persona_to_out(r)


class ActivityItem(BaseModel):
    kind: str   # "meeting" | "rated" | "taught" | "distilled"
    ts: str
    detail: str


class ActivityResponse(BaseModel):
    sme_id: str
    items: list[ActivityItem]


@router.get("/{sme_id}/activity", response_model=ActivityResponse)
async def get_activity(sme_id: str) -> ActivityResponse:
    """Recent events for this SME, used by the SR card to render an
    'agent-like' activity feed. Derived from decisions / sme_feedback /
    sme_knowledge — no separate audit table needed today."""
    items: list[ActivityItem] = []
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            # Meetings convened
            await cur.execute(
                """
                SELECT slug, question, outcome, opened_at
                  FROM decisions
                 WHERE %s = ANY(panel)
                 ORDER BY opened_at DESC LIMIT 10
                """,
                (sme_id,),
            )
            for r in await cur.fetchall():
                items.append(
                    ActivityItem(
                        kind="meeting",
                        ts=r["opened_at"].isoformat(),
                        detail=f"{r['outcome']} · {(r['question'] or '').strip()[:80]}",
                    )
                )
            # User feedback received
            await cur.execute(
                """
                SELECT rating, created_at, decision_slug
                  FROM sme_feedback
                 WHERE sme_id = %s
                 ORDER BY created_at DESC LIMIT 10
                """,
                (sme_id,),
            )
            for r in await cur.fetchall():
                items.append(
                    ActivityItem(
                        kind="rated",
                        ts=r["created_at"].isoformat(),
                        detail=(
                            "marked useful" if r["rating"] == 1 else "marked not useful"
                        ),
                    )
                )
            # Knowledge added
            await cur.execute(
                """
                SELECT text, created_at
                  FROM sme_knowledge
                 WHERE sme_id = %s
                 ORDER BY created_at DESC LIMIT 5
                """,
                (sme_id,),
            )
            for r in await cur.fetchall():
                items.append(
                    ActivityItem(
                        kind="taught",
                        ts=r["created_at"].isoformat(),
                        detail=(r["text"] or "").strip()[:100],
                    )
                )

    items.sort(key=lambda i: i.ts, reverse=True)
    return ActivityResponse(sme_id=sme_id, items=items[:15])


@router.delete("/personas/{pid}", status_code=204)
async def delete_persona(pid: str) -> None:
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute("DELETE FROM sme_personas WHERE id = %s", (pid,))
            await cur.execute("DELETE FROM sme_knowledge WHERE sme_id = %s", (pid,))


# ─── Calibration · thumbs feedback + aggregate scores ────────────────────


class FeedbackIn(BaseModel):
    sme_id: str
    decision_slug: str
    rating: int = Field(ge=-1, le=1)
    note: str | None = Field(default=None, max_length=300)


class CalibrationOut(BaseModel):
    sme_id: str
    total: int
    up: int
    down: int
    accuracy: float | None


@router.post("/feedback", status_code=204)
async def add_feedback(body: FeedbackIn) -> None:
    if body.rating == 0:
        raise HTTPException(400, "rating must be -1 or 1")
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO sme_feedback (sme_id, decision_slug, rating, note)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (sme_id, decision_slug)
                  DO UPDATE SET rating = EXCLUDED.rating, note = EXCLUDED.note
                """,
                (body.sme_id, body.decision_slug, body.rating, body.note),
            )


@router.get("/calibration/{sid}", response_model=CalibrationOut)
async def get_calibration(sid: str) -> CalibrationOut:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT
                  COUNT(*)::int                       AS total,
                  COUNT(*) FILTER (WHERE rating = 1)::int  AS up,
                  COUNT(*) FILTER (WHERE rating = -1)::int AS down
                FROM sme_feedback
                WHERE sme_id = %s
                  AND created_at >= NOW() - INTERVAL '90 days'
                """,
                (sid,),
            )
            r = await cur.fetchone() or {"total": 0, "up": 0, "down": 0}
    total = int(r["total"])
    return CalibrationOut(
        sme_id=sid,
        total=total,
        up=int(r["up"]),
        down=int(r["down"]),
        accuracy=round(int(r["up"]) / total, 3) if total > 0 else None,
    )


@router.get("/calibration", response_model=dict[str, CalibrationOut])
async def get_all_calibration() -> dict[str, CalibrationOut]:
    """All SMEs in one call — for the SR cards."""
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT
                  sme_id,
                  COUNT(*)::int                       AS total,
                  COUNT(*) FILTER (WHERE rating = 1)::int  AS up,
                  COUNT(*) FILTER (WHERE rating = -1)::int AS down
                FROM sme_feedback
                WHERE created_at >= NOW() - INTERVAL '90 days'
                GROUP BY sme_id
                """
            )
            rows = await cur.fetchall()
    out: dict[str, CalibrationOut] = {}
    for r in rows:
        total = int(r["total"])
        out[r["sme_id"]] = CalibrationOut(
            sme_id=r["sme_id"],
            total=total,
            up=int(r["up"]),
            down=int(r["down"]),
            accuracy=round(int(r["up"]) / total, 3) if total > 0 else None,
        )
    return out


# ─── Ledger replay distiller (closes the learning loop) ─────────────────


class DistillIn(BaseModel):
    sme_id: str
    look_back_days: int = Field(default=14, ge=1, le=90)
    dry_run: bool = False


class DistillOut(BaseModel):
    sme_id: str
    sampled_decisions: int
    notes_added: int
    notes: list[str]


_DISTILL_SYSTEM = (
    "You read a stack of past Standing Meeting transcripts where this SME "
    "was on the panel, and distill 3-5 SHORT institutional rules the SME "
    "should carry into future meetings. Each rule MUST be a single line, "
    "actionable, and grounded in the recurring patterns you see. Skip "
    "anything that only showed up once. Output ONLY a JSON object: "
    '{"notes": ["...", "..."]}'
)


@router.post("/distill", response_model=DistillOut)
async def distill(body: DistillIn) -> DistillOut:
    """Read recent decisions where this SME participated, ask the LLM to
    summarise recurring patterns, and persist them as auto-generated
    sme_knowledge rows (importance 3, enabled=TRUE).

    Idempotent enough for daily replay — duplicate-text rows are skipped."""
    # 1. Sample past decisions where this SME was on the panel
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT slug, question, panel, receipts, opened_at, closed_at,
                       outcome, context_label
                  FROM decisions
                 WHERE %s = ANY(panel)
                   AND opened_at >= NOW() - (%s || ' days')::interval
                   AND receipts IS NOT NULL
                 ORDER BY opened_at DESC
                 LIMIT 30
                """,
                (body.sme_id, body.look_back_days),
            )
            rows = await cur.fetchall()

    if len(rows) < 2:
        return DistillOut(
            sme_id=body.sme_id,
            sampled_decisions=len(rows),
            notes_added=0,
            notes=[],
        )

    # 2. Build a corpus of this SME's contributions
    parts: list[str] = []
    for r in rows:
        receipts = r.get("receipts") or {}
        if isinstance(receipts, dict):
            entry = receipts.get(body.sme_id)
            if isinstance(entry, dict):
                txt = str(entry.get("text", "")).strip()
                if txt:
                    parts.append(
                        f"### {r['slug']} · {r['question']}\n"
                        f"(outcome: {r['outcome']})\n"
                        f"{txt[:800]}"
                    )

    if len(parts) < 2:
        return DistillOut(
            sme_id=body.sme_id,
            sampled_decisions=len(rows),
            notes_added=0,
            notes=[],
        )

    corpus = "\n\n".join(parts[:15])
    user_msg = (
        f"SME id: {body.sme_id}\n"
        f"Past meetings ({len(parts)}):\n\n{corpus}\n\n"
        "Return JSON only."
    )

    # 3. Call the LLM
    client = async_client()
    try:
        resp = await client.chat.completions.create(
            model=chat_model_id(),
            messages=[
                {"role": "system", "content": _DISTILL_SYSTEM},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.1,
            max_tokens=300,
            response_format={"type": "json_object"},
        )
    except Exception:
        resp = await client.chat.completions.create(
            model=chat_model_id(),
            messages=[
                {"role": "system", "content": _DISTILL_SYSTEM},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.1,
            max_tokens=300,
        )
    content = (resp.choices[0].message.content or "").strip() if resp.choices else ""
    cost.record(
        "sme-distill",
        len(_DISTILL_SYSTEM) + len(user_msg),
        len(content),
        chat_model_id(),
        sme_id=body.sme_id,
    )

    try:
        start = content.find("{")
        end = content.rfind("}")
        if start >= 0 and end > start:
            content = content[start : end + 1]
        parsed = json.loads(content)
    except Exception:  # noqa: BLE001
        log.warning("distill.parse_failed sme=%s body=%s", body.sme_id, content[:200])
        return DistillOut(
            sme_id=body.sme_id,
            sampled_decisions=len(rows),
            notes_added=0,
            notes=[],
        )

    raw_notes = parsed.get("notes") or []
    notes: list[str] = []
    for n in raw_notes:
        if isinstance(n, str):
            t = n.strip()
            if 5 <= len(t) <= 500:
                notes.append(t)
    notes = notes[:5]

    if body.dry_run or not notes:
        return DistillOut(
            sme_id=body.sme_id,
            sampled_decisions=len(rows),
            notes_added=0,
            notes=notes,
        )

    # 4. Persist as sme_knowledge rows — skip duplicates by exact text match
    added = 0
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            for t in notes:
                await cur.execute(
                    "SELECT 1 FROM sme_knowledge WHERE sme_id = %s AND text = %s",
                    (body.sme_id, t),
                )
                if await cur.fetchone():
                    continue
                await cur.execute(
                    "INSERT INTO sme_knowledge (sme_id, text, importance) "
                    "VALUES (%s, %s, 3)",
                    (body.sme_id, t),
                )
                added += 1
    return DistillOut(
        sme_id=body.sme_id,
        sampled_decisions=len(rows),
        notes_added=added,
        notes=notes,
    )


# ─── Synthesis (disagreement detection) ──────────────────────────────────


class SynthIn(BaseModel):
    answers: list[dict] = Field(min_length=1, max_length=8)


class Dissenter(BaseModel):
    sme_id: str
    reason: str


class SynthOut(BaseModel):
    consensus_summary: str
    dissenters: list[Dissenter]


_SYNTH_SYSTEM = (
    "You compare 2-4 SME analyses on the same question and report whether "
    "they agree or disagree. Be terse. Output ONLY a JSON object with two "
    "keys: 'consensus_summary' (one sentence) and 'dissenters' (array of "
    "{sme_id, reason} for any SME whose conclusion materially differs "
    "from the majority — empty array if all agree). Material disagreement "
    "means different root cause, different recommended action, or "
    "incompatible severity. Stylistic differences don't count."
)


@router.post("/synthesize", response_model=SynthOut)
async def synthesize(body: SynthIn) -> SynthOut:
    # Build the user message
    pieces = ["SME ANSWERS:"]
    for a in body.answers:
        sid = str(a.get("sme_id", "?"))
        txt = str(a.get("text", "")).strip()
        pieces.append(f"\n### {sid}\n{txt}")
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
        # Some providers reject response_format; retry without.
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
    cost.record(
        "sme-synthesize",
        len(_SYNTH_SYSTEM) + len(user_msg),
        len(content),
        chat_model_id(),
    )
    try:
        # Extract the first JSON object substring — models occasionally wrap
        # the JSON in markdown fences even when asked not to.
        start = content.find("{")
        end = content.rfind("}")
        if start >= 0 and end > start:
            content = content[start : end + 1]
        parsed = json.loads(content)
    except Exception as e:  # noqa: BLE001
        log.warning("synthesize.parse_failed err=%s body=%s", e, content[:200])
        return SynthOut(consensus_summary="(could not parse)", dissenters=[])
    return SynthOut(
        consensus_summary=str(parsed.get("consensus_summary", "")).strip()[:400],
        dissenters=[
            Dissenter(
                sme_id=str(d.get("sme_id", "?"))[:64],
                reason=str(d.get("reason", "")).strip()[:300],
            )
            for d in (parsed.get("dissenters") or [])
            if isinstance(d, dict)
        ],
    )
