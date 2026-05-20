"""Environment + settings, loaded once via pydantic-settings.

All env access funnels through this module — no scattered `os.environ` reads.
The env-var names match what the spec / .env.example file documents:

    LOOM_CATALOG_URL      → catalog_url
    LOOM_DEMO_SOURCE_URL  → source_url
    BACKEND_PORT          → backend_port
    CORS_ORIGINS          → cors_origins (comma-separated)

    LLM_PROVIDER          → llm_provider ("openrouter" | "databricks")
    OPENROUTER_API_KEY    → openrouter_api_key
    OPENROUTER_BASE_URL   → openrouter_base_url
    OPENROUTER_MODEL      → openrouter_model
    DATABRICKS_HOST       → databricks_host (e.g. https://<workspace>.cloud.databricks.com)
    DATABRICKS_TOKEN      → databricks_token (PAT)
    DATABRICKS_MODEL      → databricks_model (serving endpoint name)
"""
from functools import lru_cache
from typing import Annotated, Literal

from pydantic import AliasChoices, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    catalog_url: str = Field(
        default="postgres://loom:loom@localhost:5544/loom_catalog",
        # `DATABASE_URL` is Railway's standard env name for an attached Postgres,
        # so we accept that too. The `foundation_ai` schema lives on whichever
        # URL resolves first.
        validation_alias=AliasChoices(
            "LOOM_CATALOG_URL",
            "DATABASE_URL",
            "catalog_url",
        ),
        description="Loom's own metadata DB. foundation_ai schema lives here.",
    )
    source_url: str = Field(
        default="postgres://loom:loom@localhost:5544/loom_demo_source",
        validation_alias=AliasChoices("LOOM_DEMO_SOURCE_URL", "source_url"),
        description="Default source DB for the demo. Real per-row in foundation_ai.sources.",
    )
    backend_port: int = Field(
        default=8001,
        validation_alias=AliasChoices("BACKEND_PORT", "backend_port"),
    )
    # NoDecode tells pydantic-settings NOT to JSON-decode this list field at
    # parse time. Without it, a bare URL like "http://localhost:5173" trips a
    # JSONDecodeError before the field_validator below ever runs.
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:5173"],
        validation_alias=AliasChoices("CORS_ORIGINS", "cors_origins"),
        description="Allowed origins for the Vite frontend on :5173.",
    )

    # ── LLM provider switch ──────────────────────────────────────────────
    # Both providers are wired; the switch picks one at runtime. Swap
    # without touching code by editing LLM_PROVIDER in .env.
    llm_provider: Literal["openrouter", "databricks"] = Field(
        default="openrouter",
        validation_alias=AliasChoices("LLM_PROVIDER", "llm_provider"),
        description="Active LLM provider. Both must be configured but only the active one is used.",
    )

    openrouter_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("OPENROUTER_API_KEY", "openrouter_api_key"),
    )
    openrouter_base_url: str = Field(
        default="https://openrouter.ai/api/v1",
        validation_alias=AliasChoices("OPENROUTER_BASE_URL", "openrouter_base_url"),
    )
    openrouter_model: str = Field(
        default="deepseek/deepseek-chat-v3.1",
        validation_alias=AliasChoices("OPENROUTER_MODEL", "openrouter_model"),
    )

    databricks_host: str | None = Field(
        default=None,
        validation_alias=AliasChoices("DATABRICKS_HOST", "databricks_host"),
        description="Workspace URL, e.g. https://<workspace>.cloud.databricks.com",
    )
    databricks_token: str | None = Field(
        default=None,
        validation_alias=AliasChoices("DATABRICKS_TOKEN", "databricks_token"),
        description="Databricks PAT. Treated as a secret — never logged.",
    )
    databricks_model: str = Field(
        default="databricks-dbrx-instruct",
        validation_alias=AliasChoices("DATABRICKS_MODEL", "databricks_model"),
        description="Serving endpoint name, e.g. databricks-dbrx-instruct.",
    )

    # OpenAI key — only required when embeddings are turned on. The catalog
    # works lexical-only without it.
    openai_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("OPENAI_API_KEY", "openai_api_key"),
    )

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, v: object) -> object:
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    @model_validator(mode="after")
    def _check_active_provider_configured(self) -> "Settings":
        if self.llm_provider == "openrouter" and not self.openrouter_api_key:
            raise ValueError("LLM_PROVIDER=openrouter but OPENROUTER_API_KEY is unset")
        if self.llm_provider == "databricks" and not (self.databricks_host and self.databricks_token):
            raise ValueError(
                "LLM_PROVIDER=databricks but DATABRICKS_HOST and/or DATABRICKS_TOKEN are unset"
            )
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
