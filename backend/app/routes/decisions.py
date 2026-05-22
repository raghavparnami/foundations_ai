"""Decisions Ledger — every Standing Meeting writes a row.

Endpoints:
  POST   /api/decisions/open                  open a new meeting row
  POST   /api/decisions/{slug}/close          mark closed; capture receipts
  POST   /api/decisions/{slug}/accept         outcome=accepted + accepted_sme
  GET    /api/decisions                       list (paginated)
  GET    /api/decisions/{slug}                fetch one with receipts

Receipts JSONB shape (per SME contribution):
  {
    "iris":  { "text": "<final answer>", "tokens": 234, "started_at": "...", "completed_at": "..." },
    "mason": { ... }
  }
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from app.db import get_conn

log = logging.getLogger(__name__)
router = APIRouter()


class OpenRequest(BaseModel):
    kind: str = Field(pattern=r"^(ad-hoc|briefing|sme)$")
    question: str = Field(min_length=1, max_length=2000)
    panel: list[str] = Field(min_length=1, max_length=8)
    context_label: str | None = None
    pinned_id: str | None = None


class CloseRequest(BaseModel):
    receipts: dict[str, Any] | None = None
    outcome: str | None = Field(default=None, pattern=r"^(closed|overridden)$")
    override_note: str | None = None


class AcceptRequest(BaseModel):
    accepted_sme: str
    receipts: dict[str, Any] | None = None


class DecisionOut(BaseModel):
    id: int
    slug: str
    kind: str
    question: str
    panel: list[str]
    context_label: str | None
    pinned_id: str | None
    outcome: str
    accepted_sme: str | None
    override_note: str | None
    receipts: dict[str, Any] | None
    opened_at: str
    closed_at: str | None


def _row_to_out(r: dict) -> DecisionOut:
    return DecisionOut(
        id=r["id"],
        slug=r["slug"],
        kind=r["kind"],
        question=r["question"],
        panel=list(r["panel"]),
        context_label=r.get("context_label"),
        pinned_id=r.get("pinned_id"),
        outcome=r["outcome"],
        accepted_sme=r.get("accepted_sme"),
        override_note=r.get("override_note"),
        receipts=r.get("receipts"),
        opened_at=r["opened_at"].isoformat(),
        closed_at=r["closed_at"].isoformat() if r.get("closed_at") else None,
    )


@router.post("/open", response_model=DecisionOut)
async def open_decision(body: OpenRequest) -> DecisionOut:
    slug = "d-" + uuid.uuid4().hex[:12]
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                INSERT INTO decisions
                  (slug, kind, question, panel, context_label, pinned_id, outcome)
                VALUES (%s, %s, %s, %s, %s, %s, 'open')
                RETURNING *
                """,
                (
                    slug,
                    body.kind,
                    body.question,
                    body.panel,
                    body.context_label,
                    body.pinned_id,
                ),
            )
            r = await cur.fetchone()
    if r is None:
        raise HTTPException(500, "insert failed")
    return _row_to_out(r)


@router.post("/{slug}/close", response_model=DecisionOut)
async def close_decision(slug: str, body: CloseRequest) -> DecisionOut:
    outcome = body.outcome or "closed"
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                UPDATE decisions
                   SET outcome = %s,
                       receipts = COALESCE(%s, receipts),
                       override_note = COALESCE(%s, override_note),
                       closed_at = NOW()
                 WHERE slug = %s
             RETURNING *
                """,
                (
                    outcome,
                    Jsonb(body.receipts) if body.receipts is not None else None,
                    body.override_note,
                    slug,
                ),
            )
            r = await cur.fetchone()
    if r is None:
        raise HTTPException(404, "decision not found")
    return _row_to_out(r)


@router.post("/{slug}/accept", response_model=DecisionOut)
async def accept_decision(slug: str, body: AcceptRequest) -> DecisionOut:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                UPDATE decisions
                   SET outcome = 'accepted',
                       accepted_sme = %s,
                       receipts = COALESCE(%s, receipts),
                       closed_at = NOW()
                 WHERE slug = %s
             RETURNING *
                """,
                (
                    body.accepted_sme,
                    Jsonb(body.receipts) if body.receipts is not None else None,
                    slug,
                ),
            )
            r = await cur.fetchone()
    if r is None:
        raise HTTPException(404, "decision not found")
    return _row_to_out(r)


class DecisionsList(BaseModel):
    decisions: list[DecisionOut]


@router.get("", response_model=DecisionsList)
async def list_decisions(limit: int = 100) -> DecisionsList:
    limit = max(1, min(500, limit))
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                "SELECT * FROM decisions ORDER BY opened_at DESC LIMIT %s",
                (limit,),
            )
            rows = await cur.fetchall()
    return DecisionsList(decisions=[_row_to_out(r) for r in rows])


@router.get("/{slug}", response_model=DecisionOut)
async def get_decision(slug: str) -> DecisionOut:
    async with get_conn() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                "SELECT * FROM decisions WHERE slug = %s",
                (slug,),
            )
            r = await cur.fetchone()
    if r is None:
        raise HTTPException(404, "decision not found")
    return _row_to_out(r)


# Touch the imports so linters don't strip unused ones at module load.
_ = datetime, timezone
