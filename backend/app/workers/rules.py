"""Runtime loader for ``docs/rules/<name>.md`` rule files.

Port of src/lib/worker/rules.ts. Read on every call — the cost is microseconds
before a network LLM call, and skipping the cache means rule edits take effect
on the next tick without restarting the server. If the file is missing,
returns "" so workers fall back to their baked-in system prompts.
"""
from __future__ import annotations

from pathlib import Path

# Repo root is two levels above this file (backend/app/workers → backend → repo).
_RULES_DIR = Path(__file__).resolve().parents[3] / "docs" / "rules"


def load_rules(name: str) -> str:
    """Read ``docs/rules/<name>.md`` and return its stripped contents.

    Returns the empty string if the file does not exist or cannot be read.
    """
    path = _RULES_DIR / f"{name}.md"
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def with_rules(base_prompt: str, name: str) -> str:
    """Append the named rule file (if present) to a base system prompt.

    Used everywhere we build an LLM system prompt for wiki/view generation so
    ``docs/rules/`` files are the single source of truth for content rules.
    """
    rules = load_rules(name)
    if not rules:
        return base_prompt
    return f"{base_prompt}\n\n---\n\n{rules}"
