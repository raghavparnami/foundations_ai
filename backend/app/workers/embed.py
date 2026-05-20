"""OpenAI embeddings wrapper.

Port of src/lib/worker/embed.ts. Returns None cleanly when OPENAI_API_KEY is
unset, so the rest of the catalog still works (lexical-only retrieval) until
a key is provided.
"""
from __future__ import annotations

import logging

import httpx

from ..config import get_settings

log = logging.getLogger(__name__)

MODEL = "text-embedding-3-small"
EMBEDDING_DIM = 1536
_BATCH = 96
_ENDPOINT = "https://api.openai.com/v1/embeddings"


def embeddings_enabled() -> bool:
    return bool(get_settings().openai_api_key)


async def embed_one(text: str) -> list[float] | None:
    vecs = await embed_many([text])
    return vecs[0] if vecs else None


async def embed_many(texts: list[str]) -> list[list[float]] | None:
    key = get_settings().openai_api_key
    if not key:
        return None
    if not texts:
        return []

    out: list[list[float]] = []
    async with httpx.AsyncClient(timeout=30) as client:
        for i in range(0, len(texts), _BATCH):
            chunk = texts[i : i + _BATCH]
            vecs = await _call_batch(client, key, chunk)
            out.extend(vecs)
    return out


async def _call_batch(client: httpx.AsyncClient, key: str, inputs: list[str]) -> list[list[float]]:
    res = await client.post(
        _ENDPOINT,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={"model": MODEL, "input": inputs},
    )
    if res.status_code >= 400:
        body = res.text[:200]
        raise RuntimeError(f"OpenAI embeddings {res.status_code}: {body}")
    payload = res.json()
    rows = sorted(payload["data"], key=lambda d: d["index"])
    log.info("embed.batch n=%s tokens=%s", len(inputs),
             (payload.get("usage") or {}).get("total_tokens", 0))
    return [row["embedding"] for row in rows]


def to_pgvector_literal(vec: list[float]) -> str:
    return "[" + ",".join(str(v) for v in vec) + "]"
