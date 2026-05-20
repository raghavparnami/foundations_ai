import type { ToolPart } from "./ToolCall";

/**
 * Right-side "agent plan" panel — derives a live checklist from the current
 * assistant turn's tool calls. Ported from src/components/TodoPanel.tsx and
 * adapted to our SSE-driven ToolPart shape.
 */
export default function TodoPanel({
  toolParts,
  isStreaming,
}: {
  toolParts: ToolPart[];
  isStreaming: boolean;
}) {
  const empty = toolParts.length === 0 && !isStreaming;
  const planPart = toolParts.find((p) => p.type === "tool-plan");
  const planSteps = extractPlanSteps(planPart);
  const nonPlanParts = toolParts.filter((p) => p.type !== "tool-plan");

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
            completed={nonPlanParts.filter(
              (p) => p.state === "output-available" || p.state === "output-error",
            ).length}
            running={nonPlanParts.some(
              (p) => p.state !== "output-available" && p.state !== "output-error",
            )}
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
  type PlanOut = { ok?: boolean; steps?: unknown };
  let out: PlanOut | undefined;
  if (typeof part.output === "string") {
    try {
      out = JSON.parse(part.output) as PlanOut;
    } catch {
      out = undefined;
    }
  } else if (part.output && typeof part.output === "object") {
    out = part.output as PlanOut;
  }
  const input = (part.input ?? {}) as { steps?: unknown };
  // The plan tool's *output* shape is [{id, label}, ...]; the streamed *input*
  // is plain ["step text", ...]. Prefer input (streams sooner), fall back to
  // output. Either way, normalise to plain strings.
  const raw = (input.steps ?? out?.steps) as unknown;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s): string => {
      if (typeof s === "string") return s.trim();
      if (
        s &&
        typeof s === "object" &&
        typeof (s as { label?: unknown }).label === "string"
      ) {
        return (s as { label: string }).label.trim();
      }
      return "";
    })
    .filter((s) => s.length > 0)
    .slice(0, 8);
}

function PlanList({
  steps,
  completed,
  running,
  anyError,
}: {
  steps: string[];
  completed: number;
  running: boolean;
  anyError: boolean;
}) {
  return (
    <ul className="space-y-1">
      {steps.map((s, i) => {
        let state: "done" | "running" | "pending" | "failed";
        if (i < completed) state = "done";
        else if (i === completed && running) state = "running";
        else state = "pending";
        if (state === "done" && i === completed - 1 && anyError) state = "failed";
        return <TodoItem key={i} state={state} label={s} />;
      })}
    </ul>
  );
}

function describe(p: ToolPart): {
  state: "running" | "done" | "failed";
  label: string;
  sub?: string;
} {
  const name = p.type.replace(/^tool-/, "");
  const input = (p.input ?? {}) as Record<string, unknown>;
  type Out = { ok?: boolean; error?: string; row_count?: number };
  let output: Out | null = null;
  if (typeof p.output === "string") {
    try {
      output = JSON.parse(p.output) as Out;
    } catch {
      output = null;
    }
  } else if (p.output && typeof p.output === "object") {
    output = p.output as Out;
  }

  const done = p.state === "output-available";
  const errored =
    p.state === "output-error" ||
    (done && output?.error !== undefined) ||
    (done && output?.ok === false);
  const state: "running" | "done" | "failed" = errored
    ? "failed"
    : done
      ? "done"
      : "running";

  return { state, label: humanLabel(name), sub: humanSub(name, input, output) };
}

function humanLabel(name: string): string {
  switch (name) {
    case "list_tables":
      return "Listing tables";
    case "describe_table":
      return "Reading the docs";
    case "sample_rows":
      return "Sampling rows";
    case "run_sql":
      return "Running SQL";
    case "propose_view":
      return "Saving view";
    case "generate_chart":
      return "Drawing chart";
    case "generate_report":
      return "Writing report";
    case "generate_presentation":
      return "Building deck";
    case "browse_wiki":
      return "Browsing wiki";
    case "search_wiki":
      return "Searching wiki";
    case "open_wiki_page":
      return "Opening wiki page";
    default:
      return name.replace(/_/g, " ");
  }
}

function humanSub(
  name: string,
  input: Record<string, unknown>,
  output: { row_count?: number } | null,
): string | undefined {
  if (name === "describe_table" || name === "sample_rows") {
    const schema = (input["schema"] ?? "") as string;
    const table = (input["table"] ?? input["table_name"] ?? "") as string;
    if (schema && table) return `${schema}.${table}`;
    return table || undefined;
  }
  if (name === "run_sql") {
    const sql = (input["sql"] ?? "") as string;
    const m = sql.match(/from\s+([\w."]+)/i);
    const tbl = m?.[1]?.replace(/"/g, "");
    const n = output?.row_count;
    if (tbl && typeof n === "number")
      return `${tbl} · ${n} row${n === 1 ? "" : "s"}`;
    if (tbl) return tbl;
    return sql.slice(0, 40);
  }
  if (name === "propose_view") return ((input["name"] ?? "") as string) || undefined;
  if (name === "generate_chart") return ((input["title"] ?? "") as string) || undefined;
  if (name === "generate_report" || name === "generate_presentation")
    return ((input["title"] ?? "") as string) || undefined;
  if (name === "browse_wiki" || name === "open_wiki_page" || name === "search_wiki")
    return ((input["slug"] ?? input["query"] ?? "") as string) || undefined;
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
          <div className="text-[10px] text-[var(--text-faint)] truncate font-mono">
            {sub}
          </div>
        )}
      </div>
    </li>
  );
}

function StateIcon({
  state,
}: {
  state: "running" | "done" | "failed" | "pending";
}) {
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
        <svg
          width="9"
          height="9"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#fff"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
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
          width: 14,
          height: 14,
          marginTop: 1,
          flexShrink: 0,
          borderRadius: 999,
          background: "#dc2626",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg
          width="8"
          height="8"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#fff"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </span>
    );
  }
  return (
    <span
      aria-hidden
      style={{
        width: 14,
        height: 14,
        marginTop: 1,
        flexShrink: 0,
        borderRadius: 999,
        border: "1.5px solid var(--accent)",
        position: "relative",
        animation: "pulse 1.4s ease-in-out infinite",
      }}
    >
      <span
        style={{
          position: "absolute",
          inset: 3,
          borderRadius: 999,
          background: "var(--accent)",
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
