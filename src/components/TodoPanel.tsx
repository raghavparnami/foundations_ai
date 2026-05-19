"use client";
import type { UIMessage } from "ai";
import type { ToolPart } from "./ToolCall";

/**
 * Live "agent plan" panel. Derives a checklist from the latest assistant
 * message's tool invocations:
 *   - "input-streaming" / "input-available"  → in-progress (amber pulse)
 *   - "output-available"                      → done (green check)
 *   - "output-error" or output.error          → failed (red x)
 *
 * The list resets visually when a fresh user turn arrives because we always
 * source from the LAST assistant message. While the agent is still thinking
 * (no parts yet), we render a quiet "thinking…" placeholder so the panel
 * isn't a blank box.
 */
export default function TodoPanel({
  messages,
  isStreaming,
}: {
  messages: UIMessage[];
  isStreaming: boolean;
}) {
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const toolParts: ToolPart[] = ((lastAssistant?.parts ?? []) as Array<{ type?: string }>)
    .filter((p): p is ToolPart => typeof p.type === "string" && p.type.startsWith("tool-"))
    .map((p) => p as ToolPart);

  // If the agent declared a plan up front, render THAT as the checklist and
  // tick steps by counting subsequent (non-plan) tool completions. Otherwise
  // fall back to listing tool calls as they happen.
  const planPart = toolParts.find((p) => p.type === "tool-plan");
  const planSteps = extractPlanSteps(planPart);

  // Subsequent tool parts (everything after the plan call, excluding the
  // plan itself). Order matches stream order.
  const nonPlanParts = toolParts.filter((p) => p.type !== "tool-plan");

  const empty = toolParts.length === 0 && !isStreaming;

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <div>
          <h3 className="text-[12px] font-semibold tracking-tight text-[var(--text)]">
            Agent plan
          </h3>
          <p className="text-[10px] text-[var(--text-faint)] -mt-0.5">
            ticks off as Loom works
          </p>
        </div>
        <Dot streaming={isStreaming} />
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {empty && (
          <div className="text-[11px] text-[var(--text-faint)] px-2 py-6 text-center border border-dashed border-[var(--border)] rounded-lg">
            Ask a question — the agent's steps will appear here as it works.
          </div>
        )}
        {toolParts.length === 0 && isStreaming && (
          <TodoItem state="running" label="Thinking…" sub="planning the approach" />
        )}

        {planSteps.length > 0 ? (
          <PlanList
            steps={planSteps}
            completed={nonPlanParts.length}
            isStreaming={isStreaming}
            anyError={nonPlanParts.some((p) => p.state === "output-error")}
          />
        ) : (
          <ul className="space-y-1">
            {nonPlanParts.map((p, i) => {
              const { state, label, sub } = describe(p);
              return <TodoItem key={i} state={state} label={label} sub={sub} />;
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function extractPlanSteps(part: ToolPart | undefined): string[] {
  if (!part) return [];
  const out = part.output as { ok?: boolean; steps?: unknown } | undefined;
  const input = part.input as { steps?: unknown } | undefined;
  // Prefer the output (post-validation) but fall back to the streamed input
  // so the plan shows up as soon as the args land — before output-available.
  const raw = (out?.steps ?? input?.steps) as unknown;
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is string => typeof s === "string" && s.trim().length > 0).slice(0, 6);
}

function PlanList({
  steps,
  completed,
  isStreaming,
  anyError,
}: {
  steps: string[];
  completed: number;
  isStreaming: boolean;
  anyError: boolean;
}) {
  return (
    <ul className="space-y-1">
      {steps.map((s, i) => {
        let state: "done" | "running" | "pending" | "failed";
        if (i < completed) state = "done";
        else if (i === completed && isStreaming) state = "running";
        else state = "pending";
        if (state === "done" && i === completed - 1 && anyError) state = "failed";
        return <TodoItem key={i} state={state} label={s} />;
      })}
    </ul>
  );
}

function describe(p: ToolPart): { state: "running" | "done" | "failed"; label: string; sub?: string } {
  const name = p.type.replace(/^tool-/, "");
  const input = (p.input ?? {}) as Record<string, unknown>;
  const output = (p.output ?? null) as { ok?: boolean; error?: string; rows?: unknown[]; row_count?: number } | null;

  const done = p.state === "output-available" || p.state === "result";
  const errored = p.state === "output-error" || (done && output?.error) || (done && output?.ok === false);
  const state: "running" | "done" | "failed" = errored ? "failed" : done ? "done" : "running";

  const label = humanLabel(name);
  const sub = humanSub(name, input, output);
  return { state, label, sub };
}

function humanLabel(name: string): string {
  switch (name) {
    case "list_tables":           return "Listing tables";
    case "describe_table":        return "Reading the docs";
    case "sample_rows":           return "Sampling rows";
    case "run_sql":               return "Running SQL";
    case "propose_view":          return "Saving view";
    case "generate_chart":        return "Drawing chart";
    case "generate_report":       return "Writing report";
    case "generate_presentation": return "Building deck";
    default:                      return name.replace(/_/g, " ");
  }
}

function humanSub(
  name: string,
  input: Record<string, unknown>,
  output: { row_count?: number; rows?: unknown[] } | null,
): string | undefined {
  if (name === "describe_table" || name === "sample_rows") {
    const t = (input["table_name"] ?? "") as string;
    return t ? `\`${t}\`` : undefined;
  }
  if (name === "run_sql") {
    const sql = (input["sql"] ?? "") as string;
    const m = sql.match(/from\s+([\w."]+)/i);
    const tbl = m?.[1]?.replace(/"/g, "");
    const n = output?.row_count;
    if (tbl && typeof n === "number") return `${tbl} · ${n} row${n === 1 ? "" : "s"}`;
    if (tbl) return tbl;
    return sql.slice(0, 40);
  }
  if (name === "propose_view") {
    return ((input["name"] ?? "") as string) || undefined;
  }
  if (name === "generate_chart") {
    return ((input["title"] ?? "") as string) || undefined;
  }
  if (name === "generate_report" || name === "generate_presentation") {
    return ((input["title"] ?? "") as string) || undefined;
  }
  return undefined;
}

function TodoItem({
  state,
  label,
  sub,
}: {
  state: "running" | "done" | "failed" | "pending";
  label: string;
  sub?: string;
}) {
  return (
    <li className="flex items-start gap-2.5 px-2 py-1.5 rounded-md hover:bg-[var(--bg-elev)]">
      <StateIcon state={state} />
      <div className="min-w-0 flex-1">
        <div className="text-[12px] text-[var(--text)] leading-tight">{label}</div>
        {sub && (
          <div className="text-[10px] text-[var(--text-faint)] truncate font-mono">{sub}</div>
        )}
      </div>
    </li>
  );
}

function StateIcon({ state }: { state: "running" | "done" | "failed" | "pending" }) {
  if (state === "pending") {
    return (
      <span
        aria-hidden
        style={{
          width: 14,
          height: 14,
          marginTop: 1,
          flexShrink: 0,
          borderRadius: 999,
          border: "1.5px solid var(--border-strong)",
          background: "transparent",
        }}
      />
    );
  }
  if (state === "done") {
    return (
      <span
        aria-hidden
        style={{
          width: 14,
          height: 14,
          marginTop: 1,
          flexShrink: 0,
          borderRadius: 999,
          background: "var(--accent)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span
        aria-hidden
        style={{
          width: 14, height: 14, marginTop: 1, flexShrink: 0, borderRadius: 999,
          background: "#dc2626", display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </span>
    );
  }
  return (
    <span
      aria-hidden
      style={{
        width: 14, height: 14, marginTop: 1, flexShrink: 0, borderRadius: 999,
        border: "1.5px solid var(--accent)",
        position: "relative",
        animation: "pulse 1.4s ease-in-out infinite",
      }}
    >
      <span
        style={{
          position: "absolute", inset: 3, borderRadius: 999, background: "var(--accent)",
        }}
      />
    </span>
  );
}

function Dot({ streaming }: { streaming: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        width: 8,
        height: 8,
        borderRadius: 999,
        background: streaming ? "var(--accent)" : "var(--border-strong)",
        animation: streaming ? "pulse 1.4s ease-in-out infinite" : "none",
        display: "inline-block",
      }}
    />
  );
}
