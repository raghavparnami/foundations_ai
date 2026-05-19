/**
 * Runtime loader for `docs/rules/<name>.md` rule files.
 *
 * Read on every call — the cost is microseconds before a network LLM call,
 * and skipping the cache means rule edits take effect on the next tick
 * without restarting the server. If the file is missing, returns "" so
 * the worker falls back to its baked-in system prompt with no extra rules.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd(), "docs", "rules");

export function loadRules(name: "wiki" | "views"): string {
  try {
    return readFileSync(resolve(ROOT, `${name}.md`), "utf8").trim();
  } catch {
    return "";
  }
}

/**
 * Append the named rule file (if present) to a base system prompt. Use this
 * everywhere we build an LLM system prompt for wiki/view generation so the
 * `docs/rules/` files are the single source of truth for content + skip rules.
 */
export function withRules(basePrompt: string, name: "wiki" | "views"): string {
  const rules = loadRules(name);
  if (!rules) return basePrompt;
  return `${basePrompt}\n\n---\n\n${rules}`;
}
