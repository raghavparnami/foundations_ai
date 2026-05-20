"""LLM client factory.

Both OpenRouter and Databricks Foundation Model serving expose an
OpenAI-compatible REST surface, so a single `openai.OpenAI` client works for
both — the only difference is `base_url`, `api_key`, and the `model` string.

The active provider is decided by `LLM_PROVIDER` in `.env` (validated in
config.py). Swap providers with one env-var change — no code edits.

Two entry points:
    - `client()` — raw OpenAI-compatible client for streaming / tool calls
    - `chat_model_id()` — the model string to pass when calling that client
"""
from functools import lru_cache

from openai import AsyncOpenAI, OpenAI

from .config import get_settings


@lru_cache(maxsize=1)
def client() -> OpenAI:
    """Sync client. Use for one-shot offline calls (doc-writer, view seeder)."""
    s = get_settings()
    if s.llm_provider == "openrouter":
        return OpenAI(
            api_key=s.openrouter_api_key,
            base_url=s.openrouter_base_url,
            default_headers={"HTTP-Referer": "https://loom.local", "X-Title": "Loom v0.5"},
        )
    # databricks: serving endpoints accept OpenAI-format at /serving-endpoints.
    # The model_validator in config.py guarantees host+token are set when
    # llm_provider == 'databricks', but assert here so mypy can narrow them.
    assert s.databricks_host is not None and s.databricks_token is not None
    return OpenAI(
        api_key=s.databricks_token,
        base_url=f"{s.databricks_host.rstrip('/')}/serving-endpoints",
    )


@lru_cache(maxsize=1)
def async_client() -> AsyncOpenAI:
    """Async client. Use for streaming chat to the SSE route."""
    s = get_settings()
    if s.llm_provider == "openrouter":
        return AsyncOpenAI(
            api_key=s.openrouter_api_key,
            base_url=s.openrouter_base_url,
            default_headers={"HTTP-Referer": "https://loom.local", "X-Title": "Loom v0.5"},
        )
    assert s.databricks_host is not None and s.databricks_token is not None
    return AsyncOpenAI(
        api_key=s.databricks_token,
        base_url=f"{s.databricks_host.rstrip('/')}/serving-endpoints",
    )


def chat_model_id() -> str:
    """The model identifier to pass to chat.completions.create(model=...)."""
    s = get_settings()
    return s.openrouter_model if s.llm_provider == "openrouter" else s.databricks_model


def provider_label() -> str:
    """Short string for logs and the /health response."""
    return get_settings().llm_provider
