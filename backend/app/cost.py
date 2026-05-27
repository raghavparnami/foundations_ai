"""LLM cost tracker — in-memory, resets on process restart ("this shift").

Every LLM completion in the system should call `record()` once. The tracker
keeps a running tally of prompt + completion tokens by call type and a
rough USD estimate using a per-model price table.

Token counts are estimates (~4 chars/token) when the provider streams
without usage; exact when the provider returns a `usage` object.

Exposed:
  record(kind, prompt_chars, completion_chars, model=None)
  snapshot() → dict for /api/llm/cost-meter
  reset() → clear (for tests / "new shift")
"""
from __future__ import annotations

import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone

# ──────────────────────────────────────────────────────────────────────────
# Pricing table. USD per 1M tokens. Update when models change.
# Sources: openrouter.ai pricing as of 2026-05.
# ──────────────────────────────────────────────────────────────────────────

_PRICING_USD_PER_M: dict[str, tuple[float, float]] = {
    # model_id → (input_per_M, output_per_M)
    "deepseek/deepseek-chat-v3.1": (0.27, 1.10),
    "deepseek/deepseek-chat-v3": (0.27, 1.10),
    "anthropic/claude-3-5-sonnet": (3.00, 15.00),
    "openai/gpt-4o-mini": (0.15, 0.60),
    "databricks-dbrx-instruct": (0.75, 2.25),
    "databricks-llama-3-1-405b-instruct": (5.00, 15.00),
}
_FALLBACK_PRICING = (0.50, 1.50)  # rough median for unknown models


def _price(model: str) -> tuple[float, float]:
    return _PRICING_USD_PER_M.get(model, _FALLBACK_PRICING)


def _est_tokens(chars: int) -> int:
    return max(0, chars // 4)


# ──────────────────────────────────────────────────────────────────────────
# State
# ──────────────────────────────────────────────────────────────────────────


@dataclass(slots=True)
class Bucket:
    calls: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0


@dataclass(slots=True)
class _State:
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    by_kind: dict[str, Bucket] = field(default_factory=dict)
    by_model: dict[str, Bucket] = field(default_factory=dict)
    by_sme: dict[str, Bucket] = field(default_factory=dict)
    total: Bucket = field(default_factory=Bucket)


_state = _State()
_lock = threading.Lock()


def record(
    kind: str,
    prompt_chars: int,
    completion_chars: int,
    model: str | None = None,
    sme_id: str | None = None,
) -> None:
    """Record one LLM call. `kind` is a free-text bucket: 'chat-agent',
    'sme-deliberate', 'sme-synthesize', 'doc-writer', 'wiki-agent', etc.
    `sme_id` (optional) attributes the call to a specific persona so we
    can show per-SME spend on the cards."""
    m = (model or "unknown").strip()
    p_tok = _est_tokens(prompt_chars)
    c_tok = _est_tokens(completion_chars)
    in_per_m, out_per_m = _price(m)
    cost = (p_tok / 1_000_000) * in_per_m + (c_tok / 1_000_000) * out_per_m
    with _lock:
        buckets = [
            _state.total,
            _state.by_kind.setdefault(kind, Bucket()),
            _state.by_model.setdefault(m, Bucket()),
        ]
        if sme_id:
            buckets.append(_state.by_sme.setdefault(sme_id, Bucket()))
        for b in buckets:
            b.calls += 1
            b.prompt_tokens += p_tok
            b.completion_tokens += c_tok
            b.cost_usd += cost


def snapshot() -> dict:
    with _lock:
        return {
            "started_at": _state.started_at.isoformat(),
            "total": {
                "calls": _state.total.calls,
                "prompt_tokens": _state.total.prompt_tokens,
                "completion_tokens": _state.total.completion_tokens,
                "cost_usd": round(_state.total.cost_usd, 4),
            },
            "by_kind": {
                k: {
                    "calls": b.calls,
                    "tokens": b.prompt_tokens + b.completion_tokens,
                    "cost_usd": round(b.cost_usd, 4),
                }
                for k, b in _state.by_kind.items()
            },
            "by_model": {
                m: {
                    "calls": b.calls,
                    "tokens": b.prompt_tokens + b.completion_tokens,
                    "cost_usd": round(b.cost_usd, 4),
                }
                for m, b in _state.by_model.items()
            },
            "by_sme": {
                s: {
                    "calls": b.calls,
                    "tokens": b.prompt_tokens + b.completion_tokens,
                    "cost_usd": round(b.cost_usd, 4),
                }
                for s, b in _state.by_sme.items()
            },
        }


def reset() -> None:
    global _state
    with _lock:
        _state = _State()
