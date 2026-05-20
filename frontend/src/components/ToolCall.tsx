import { useState } from "react";

/**
 * Card that renders a single tool invocation: name + args + collapsible result
 * preview. Mirrors the legacy AI SDK v6 message-part shape but is decoupled
 * from `ai` types so callers can pass either a structured tool part or a
 * `ChatStreamEvent`-derived shape.
 */
export type ToolPart = {
  type: string;
  toolCallId?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

type ToolCallProps = {
  part: ToolPart;
};

export default function ToolCall({ part }: ToolCallProps) {
  const [expanded, setExpanded] = useState(false);
  const name = part.type
    .replace(/^tool-/, "")
    .replace(/^dynamic-tool-/, "");
  const done =
    part.state === "output-available" ||
    part.state === "output-error" ||
    part.state === "result";
  const errored = part.state === "output-error";

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2 text-[12px]">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-medium text-[var(--text)]/90">{name}</span>
        <span
          className={
            errored
              ? "text-red-600"
              : done
                ? "text-[var(--text-faint)]"
                : "text-amber-400"
          }
        >
          {errored ? "x" : done ? "ok" : "..."}
        </span>
      </div>
      {part.input !== undefined && part.input !== null ? (
        <div className="whitespace-pre-wrap break-all text-[var(--text-muted)]">
          {summarizeInput(part.input)}
        </div>
      ) : null}
      {done ? (
        <div className="mt-1">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="cursor-pointer text-[11px] text-[var(--text-faint)] hover:text-[var(--text)]"
          >
            {expanded
              ? errored
                ? "hide error"
                : "hide result"
              : errored
                ? "show error"
                : "show result"}
          </button>
          {expanded ? (
            <pre className="mt-1 max-h-48 overflow-x-auto text-[11px] text-[var(--text-muted)]">
              {errored
                ? part.errorText ?? "unknown error"
                : summarize(part.output)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function summarizeInput(input: unknown): string {
  if (
    input &&
    typeof input === "object" &&
    "sql" in input &&
    typeof (input as { sql: unknown }).sql === "string"
  ) {
    const sql = (input as { sql: string }).sql;
    return sql.length > 240 ? sql.slice(0, 240) + "..." : sql;
  }
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

function summarize(out: unknown): string {
  if (out == null) return "-";
  if (typeof out === "string") return out;
  try {
    const s = JSON.stringify(out, null, 2);
    return s.length > 2000 ? s.slice(0, 2000) + "\n...(truncated)" : s;
  } catch {
    return String(out);
  }
}
