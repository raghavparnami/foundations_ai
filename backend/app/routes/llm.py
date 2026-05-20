"""LLM smoke + introspection routes.

GET  /api/llm/info     — which provider + model is active. No outbound call.
POST /api/llm/test     — one-shot 1-token completion to confirm the provider
                         responds. Returns the provider, model, and the text
                         the model produced. Use this to validate
                         OPENROUTER_API_KEY / DATABRICKS_HOST+TOKEN before the
                         full agent boots and burns tokens chasing a 401.
"""
from typing import Annotated

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.llm import async_client, chat_model_id, provider_label

router = APIRouter()


class LLMInfo(BaseModel):
    provider: str
    model: str


class LLMTestRequest(BaseModel):
    prompt: Annotated[str, Field(default="Say 'ok' and nothing else.", max_length=2000)]
    max_tokens: Annotated[int, Field(default=16, ge=1, le=256)]


class LLMTestResponse(BaseModel):
    provider: str
    model: str
    output: str
    finish_reason: str | None
    usage_total_tokens: int | None


@router.get("/info", response_model=LLMInfo)
async def llm_info() -> LLMInfo:
    return LLMInfo(provider=provider_label(), model=chat_model_id())


@router.post("/test", response_model=LLMTestResponse)
async def llm_test(req: LLMTestRequest) -> LLMTestResponse:
    client = async_client()
    try:
        resp = await client.chat.completions.create(
            model=chat_model_id(),
            messages=[{"role": "user", "content": req.prompt}],
            max_tokens=req.max_tokens,
            temperature=0.0,
        )
    except Exception as e:
        # Surface upstream errors verbatim — 401, 404 (bad model), connection
        # refused all look distinct from each other in the response body.
        raise HTTPException(status_code=502, detail=f"{type(e).__name__}: {e}") from e

    choice = resp.choices[0] if resp.choices else None
    text = choice.message.content if choice and choice.message else ""
    return LLMTestResponse(
        provider=provider_label(),
        model=chat_model_id(),
        output=(text or "").strip(),
        finish_reason=choice.finish_reason if choice else None,
        usage_total_tokens=resp.usage.total_tokens if resp.usage else None,
    )
