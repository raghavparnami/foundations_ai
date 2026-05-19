"use client";

/**
 * AI SDK v6 emits tool invocations as message parts whose `type` is
 * `tool-<name>` (or `dynamic-tool` for dynamic ones). Possible `state`s:
 *   input-streaming → input-available → output-available | output-error
 * We render a compact card that flips from "running" to "✓" when output lands.
 */
export type ToolPart = {
  type: string;
  toolCallId?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

export default function ToolCall({ part }: { part: ToolPart }) {
  const name = part.type.replace(/^tool-/, "").replace(/^dynamic-tool-/, "");
  const done = part.state === "output-available" || part.state === "output-error";
  const errored = part.state === "output-error";

  return (
    <div className="tool-card">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[var(--accent)] font-medium">{name}</span>
        <span className={errored ? "text-red-600" : done ? "text-[var(--text-faint)]" : "text-amber-600"}>
          {errored ? "✗" : done ? "✓" : "…"}
        </span>
      </div>
      {part.input ? (
        <div className="text-[var(--text-muted)] whitespace-pre-wrap break-all">
          {summarizeInput(part.input)}
        </div>
      ) : null}
      {done ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-[var(--text-faint)] text-[11px]">
            {errored ? "error" : "result"}
          </summary>
          <pre className="mt-1 text-[11px] text-[var(--text-muted)] overflow-x-auto max-h-48">
            {errored ? (part.errorText ?? "unknown error") : summarize(part.output)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

function summarizeInput(input: unknown): string {
  if (input && typeof input === "object" && "sql" in input && typeof (input as { sql: unknown }).sql === "string") {
    const sql = (input as { sql: string }).sql;
    return sql.length > 240 ? sql.slice(0, 240) + "…" : sql;
  }
  return JSON.stringify(input, null, 2);
}

function summarize(out: unknown): string {
  if (out == null) return "—";
  if (typeof out === "string") return out;
  try {
    const s = JSON.stringify(out, null, 2);
    return s.length > 2000 ? s.slice(0, 2000) + "\n…(truncated)" : s;
  } catch {
    return String(out);
  }
}
