/**
 * One-line activity row describing what the agent is doing right now.
 *
 * Replaces the older expandable-JSON tool card. End users don't want to see
 * raw tool args / outputs — they want a short, human sentence like
 * "Reading quality-deviations…" with a tiny status pip. The raw inputs and
 * outputs are still available in the right-side TodoPanel and the audit log.
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
  const name = part.type.replace(/^tool-/, "").replace(/^dynamic-tool-/, "");
  const done =
    part.state === "output-available" ||
    part.state === "output-error" ||
    part.state === "result";
  const errored = part.state === "output-error";
  const label = labelFor(name, part.input, done);

  return (
    <div className="flex items-center gap-2 text-[12px] text-[var(--text-muted)] py-0.5">
      <StatusPip done={done} errored={errored} />
      <span className="truncate">{label}</span>
    </div>
  );
}

function StatusPip({ done, errored }: { done: boolean; errored: boolean }) {
  if (errored) {
    return (
      <span
        aria-hidden
        className="inline-block w-3 h-3 rounded-full flex items-center justify-center shrink-0"
        style={{ background: "#fee2e2", color: "#b91c1c" }}
      >
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  if (done) {
    return (
      <span
        aria-hidden
        className="inline-block w-3 h-3 rounded-full flex items-center justify-center shrink-0"
        style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
      >
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none">
          <path d="M5 12l4 4L19 6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="inline-block w-2 h-2 rounded-full animate-pulse shrink-0"
      style={{ background: "var(--accent)" }}
    />
  );
}

function labelFor(name: string, input: unknown, done: boolean): string {
  const tense = done ? "past" : "present";
  switch (name) {
    case "plan":
      return done ? "Planned the approach" : "Planning the approach…";
    case "browse_wiki": {
      const slug = pick(input, "domain_slug") ?? "the catalog";
      return done ? `Browsed ${slug}` : `Browsing ${slug}…`;
    }
    case "search_wiki": {
      const q = pick(input, "query") ?? "the wiki";
      return done ? `Searched for "${truncate(q, 60)}"` : `Searching for "${truncate(q, 60)}"…`;
    }
    case "open_wiki_page": {
      const slug = pick(input, "slug") ?? "a wiki page";
      return done ? `Read ${slug}` : `Reading ${slug}…`;
    }
    case "list_tables":
      return done ? "Listed available tables" : "Listing available tables…";
    case "describe_table": {
      const tbl = pick(input, "table") ?? pick(input, "name") ?? "a table";
      return done ? `Inspected ${tbl}` : `Inspecting ${tbl}…`;
    }
    case "sample_rows": {
      const tbl = pick(input, "table") ?? pick(input, "name") ?? "a table";
      return done ? `Sampled rows from ${tbl}` : `Sampling rows from ${tbl}…`;
    }
    case "run_sql":
      return done ? "Ran the query" : "Running the query…";
    case "generate_chart": {
      const title = pickNested(input, "spec", "title") ?? "the chart";
      return done ? `Drew ${title}` : `Drawing ${title}…`;
    }
    case "generate_report": {
      const title = pick(input, "title") ?? "a report";
      return done ? `Wrote ${title}` : `Writing ${title}…`;
    }
    case "generate_presentation": {
      const title = pickNested(input, "spec", "title") ?? "a deck";
      return done ? `Built ${title}` : `Building ${title}…`;
    }
    default:
      return tense === "past" ? `Ran ${name}` : `Running ${name}…`;
  }
}

function pick(v: unknown, key: string): string | undefined {
  if (v && typeof v === "object" && key in (v as Record<string, unknown>)) {
    const x = (v as Record<string, unknown>)[key];
    if (typeof x === "string" && x.length > 0) return x;
  }
  return undefined;
}

function pickNested(v: unknown, parentKey: string, childKey: string): string | undefined {
  if (v && typeof v === "object" && parentKey in (v as Record<string, unknown>)) {
    const inner = (v as Record<string, unknown>)[parentKey];
    return pick(inner, childKey);
  }
  return undefined;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
