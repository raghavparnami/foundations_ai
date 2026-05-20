import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { streamChat, type ChatMessage } from "../lib/chat";
import ToolCall, { type ToolPart } from "../components/ToolCall";
import TodoPanel from "../components/TodoPanel";

type TextPart = { type: "text"; text: string };
type AssistantPart = TextPart | ToolPart;

function isTextPart(p: AssistantPart): p is TextPart {
  return p.type === "text";
}

type Turn =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; parts: AssistantPart[] };

const SUGGESTIONS = [
  "What's our deviation rate by production line over the last 30 days?",
  "Which equipment is most often involved in temperature deviations?",
  "What % of quality checks failed yesterday, by parameter?",
  "Which operator's runs had the most aborted statuses last week?",
];

const WORKING_LINES = [
  "Pulling on threads…",
  "Weaving the catalog…",
  "Threading a query through…",
  "Looming a chart…",
  "Walking the audit log…",
  "Reading the docs Loom wrote earlier…",
  "Cross-stitching joins…",
  "Counting rows, gently…",
  "Polishing the answer…",
  "Tying the knots…",
  "Tracing column lineage…",
  "Brewing a fresh view…",
];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Working late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 22) return "Good evening";
  return "Working late";
}

function newSlug(): string {
  return (
    "c-" +
    Math.random().toString(36).slice(2, 10) +
    Date.now().toString(36).slice(-4)
  );
}

function storageKey(slug: string): string {
  return `loom.chat.${slug}`;
}

export default function Chat() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const urlSlug = sp.get("c");

  // Mint a slug if none in the URL. Replace silently so refresh/share works.
  useEffect(() => {
    if (!urlSlug) {
      navigate(`/?c=${newSlug()}`, { replace: true });
    }
  }, [urlSlug, navigate]);

  const slug = urlSlug ?? "";

  const [turns, setTurns] = useState<Turn[]>(() => {
    if (!urlSlug) return [];
    try {
      const raw = localStorage.getItem(storageKey(urlSlug));
      return raw ? (JSON.parse(raw) as Turn[]) : [];
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [workIdx, setWorkIdx] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Reload turns when the URL slug changes (sidebar click, new chat, etc.).
  useEffect(() => {
    if (!urlSlug) {
      setTurns([]);
      return;
    }
    try {
      const raw = localStorage.getItem(storageKey(urlSlug));
      setTurns(raw ? (JSON.parse(raw) as Turn[]) : []);
    } catch {
      setTurns([]);
    }
  }, [urlSlug]);

  // Persist on every change so navigation doesn't lose the chat.
  useEffect(() => {
    if (!slug) return;
    try {
      if (turns.length === 0) {
        localStorage.removeItem(storageKey(slug));
      } else {
        localStorage.setItem(storageKey(slug), JSON.stringify(turns));
      }
    } catch {
      // quota exceeded — silently ignore
    }
  }, [slug, turns]);

  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  }

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(
      () => setWorkIdx((i) => (i + 1) % WORKING_LINES.length),
      2200,
    );
    return () => clearInterval(t);
  }, [busy]);

  // Esc stops a running stream.
  useEffect(() => {
    if (!busy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        stop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    // If a stream is already running, abort it first — this is "redirect".
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setInput("");
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // Build server-facing history from existing turns.
    const history: ChatMessage[] = [];
    for (const t of turns) {
      if (t.role === "user") {
        history.push({ role: "user", content: t.text });
      } else {
        for (const p of t.parts) {
          if (isTextPart(p)) {
            history.push({ role: "assistant", content: p.text });
          }
        }
      }
    }
    history.push({ role: "user", content: trimmed });

    const assistantId = "a-" + Date.now().toString(36);
    setTurns((prev) => [
      ...prev,
      { id: "u-" + Date.now().toString(36), role: "user", text: trimmed },
      { id: assistantId, role: "assistant", parts: [] },
    ]);

    function patchAssistant(fn: (parts: AssistantPart[]) => AssistantPart[]) {
      setTurns((prev) => {
        const copy = [...prev];
        const i = copy.findIndex((t) => t.id === assistantId);
        if (i < 0) return prev;
        const cur = copy[i] as Extract<Turn, { role: "assistant" }>;
        copy[i] = { ...cur, parts: fn(cur.parts) };
        return copy;
      });
    }

    try {
      for await (const ev of streamChat(history, ctrl.signal, slug)) {
        if (ev.type === "tool_start") {
          const tp: ToolPart = {
            type: `tool-${ev.name}`,
            toolCallId: ev.id,
            state: "input-available",
            input: ev.args,
          };
          patchAssistant((parts) => [...parts, tp]);
        } else if (ev.type === "tool_output") {
          // Try to parse output as JSON; if it's a string, leave as-is.
          let parsed: unknown = ev.output;
          try {
            parsed = JSON.parse(ev.output);
          } catch {
            /* leave as raw string */
          }
          const errored =
            typeof parsed === "object" &&
            parsed !== null &&
            ((parsed as { error?: unknown }).error !== undefined ||
              (parsed as { ok?: unknown }).ok === false);
          patchAssistant((parts) =>
            parts.map((p) =>
              p.type !== "text" && (p as ToolPart).toolCallId === ev.id
                ? {
                    ...(p as ToolPart),
                    state: errored ? "output-error" : "output-available",
                    output: parsed,
                  }
                : p,
            ),
          );
        } else if (ev.type === "delta") {
          const deltaText = ev.text;
          patchAssistant((parts) => {
            const last = parts[parts.length - 1];
            if (last && isTextPart(last)) {
              const merged: TextPart = { type: "text", text: last.text + deltaText };
              return [...parts.slice(0, -1), merged];
            }
            const fresh: TextPart = { type: "text", text: deltaText };
            return [...parts, fresh];
          });
        } else if (ev.type === "error") {
          patchAssistant((parts) => [
            ...parts,
            { type: "text", text: `Error: ${ev.message}` },
          ]);
        }
      }
    } finally {
      if (abortRef.current === ctrl) {
        abortRef.current = null;
        setBusy(false);
      }
      inputRef.current?.focus();
    }
  }

  const empty = turns.length === 0;
  const lastAssistant = [...turns]
    .reverse()
    .find((t): t is Extract<Turn, { role: "assistant" }> => t.role === "assistant");
  const sidebarToolParts = (lastAssistant?.parts ?? []).filter(
    (p): p is ToolPart => p.type !== "text",
  );
  const showTodoPanel = !empty;

  return (
    <div className="flex flex-1 min-h-0 flex-col relative">
      <div className="flex flex-1 min-h-0">
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
          {empty ? (
            <EmptyHero onPick={(s) => void send(s)} />
          ) : (
            <div className="px-6 py-6 space-y-5 max-w-[820px] mx-auto w-full">
              {turns.map((t) =>
                t.role === "user" ? (
                  <UserBubble key={t.id} text={t.text} />
                ) : (
                  <AssistantBubble key={t.id} parts={t.parts} />
                ),
              )}
              {busy && <WorkingIndicator text={WORKING_LINES[workIdx]!} />}
            </div>
          )}
        </div>
        {showTodoPanel && (
          <aside className="hidden xl:flex w-[280px] shrink-0 border-l border-[var(--border)] bg-[var(--bg-soft)]">
            <TodoPanel toolParts={sidebarToolParts} isStreaming={busy} />
          </aside>
        )}
      </div>

      <div className="px-6 pb-6 pt-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          className="max-w-[820px] mx-auto"
        >
          <div className="input-pill">
            <div className="flex items-center gap-3">
              <Sparkle className="text-[var(--accent)] shrink-0" />
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  busy
                    ? "Type to redirect — interrupts the current answer…"
                    : "Initiate a query or send a command to Loom…"
                }
                className="flex-1 bg-transparent text-[14px] text-[var(--text)] placeholder:text-[var(--text-faint)] outline-none"
              />
              {busy && !input.trim() && (
                <button
                  type="button"
                  onClick={stop}
                  className="flex items-center gap-1.5 text-[var(--text)] text-[13px] font-medium px-3 py-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-elev)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition"
                  title="Stop generating (Esc)"
                >
                  <span
                    aria-hidden
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 2,
                      background: "var(--accent)",
                    }}
                  />
                  Stop
                </button>
              )}
              {busy && input.trim() && (
                <button
                  type="submit"
                  className="flex items-center gap-1.5 text-white text-[13px] font-medium px-4 py-1.5 rounded-full transition shadow-sm"
                  style={{ background: "var(--gradient-hero)" }}
                  title="Interrupt and redirect (Enter)"
                >
                  <span aria-hidden style={{ fontWeight: 700 }}>↗</span>
                  Redirect
                </button>
              )}
              {!busy && (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="text-white text-[13px] font-medium px-4 py-1.5 rounded-full disabled:opacity-40 transition"
                  style={{
                    background: input.trim()
                      ? "var(--gradient-hero)"
                      : "var(--border-strong)",
                  }}
                >
                  Send
                </button>
              )}
            </div>
            {empty && (
              <div className="flex flex-wrap gap-2 mt-3">
                <ActionChip
                  iconName="bar"
                  label="Run analysis"
                  onClick={() => void send(SUGGESTIONS[0]!)}
                />
                <ActionChip
                  iconName="chart"
                  label="Generate chart"
                  onClick={() =>
                    void send(
                      "Plot a chart of deviation rate by line for the last 30 days.",
                    )
                  }
                />
                <ActionChip
                  iconName="doc"
                  label="Write a report"
                  onClick={() =>
                    void send(
                      "Write an executive summary report of yesterday's quality metrics.",
                    )
                  }
                />
                <ActionChip
                  iconName="deck"
                  label="Build a deck"
                  onClick={() =>
                    void send(
                      "Build a 5-slide deck for the ops VP about this week's deviation hotspots.",
                    )
                  }
                />
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] bg-[var(--user-bg)] border border-[var(--user-border)] rounded-2xl px-4 py-2.5 text-sm text-[var(--text)] whitespace-pre-wrap">
        {text}
      </div>
    </div>
  );
}

function AssistantBubble({ parts }: { parts: AssistantPart[] }) {
  return (
    <div className="space-y-2">
      {parts.map((p, i) =>
        isTextPart(p) ? (
          <div key={i} className="markdown-doc text-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{p.text}</ReactMarkdown>
          </div>
        ) : (
          <ToolCall key={i} part={p} />
        ),
      )}
    </div>
  );
}

function WorkingIndicator({ text }: { text: string }) {
  return (
    <div className="text-[12px] text-[var(--text-muted)] flex items-center gap-2">
      <span className="inline-block w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse" />
      <span className="italic">{text}</span>
    </div>
  );
}

function EmptyHero({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="flex flex-col items-center text-center px-6 pt-20 pb-10">
      <div className="orb mb-8" aria-hidden />
      <h2 className="text-[34px] sm:text-[40px] leading-[1.1] font-semibold tracking-tight max-w-[680px]">
        {greeting()}.
        <br />
        <span className="text-[var(--text-muted)] font-medium">How can I </span>
        <span className="gradient-text font-semibold">assist you today?</span>
      </h2>
      <p className="text-[13px] text-[var(--text-muted)] mt-5 max-w-[520px]">
        Loom already indexed your tables, generated docs, and inferred join
        keys. Ask anything — I'll pull from the catalog, run read-only SQL,
        and save useful views.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-8 w-full max-w-[640px]">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="text-left text-[13px] px-3.5 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--text)] transition shadow-sm"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function ActionChip({
  iconName,
  label,
  onClick,
}: {
  iconName: "bar" | "chart" | "doc" | "deck";
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="action-chip">
      <ChipIcon name={iconName} />
      {label}
    </button>
  );
}

function ChipIcon({ name }: { name: "bar" | "chart" | "doc" | "deck" }) {
  const props = {
    width: 14,
    height: 14,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "bar":
      return (
        <svg {...props}>
          <path d="M3 21V9" />
          <path d="M9 21V3" />
          <path d="M15 21v-9" />
          <path d="M21 21V6" />
        </svg>
      );
    case "chart":
      return (
        <svg {...props}>
          <polyline points="3 17 9 11 13 15 21 7" />
          <polyline points="14 7 21 7 21 14" />
        </svg>
      );
    case "doc":
      return (
        <svg {...props}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      );
    case "deck":
      return (
        <svg {...props}>
          <rect x="3" y="4" width="18" height="12" rx="1" />
          <line x1="8" y1="20" x2="16" y2="20" />
          <line x1="12" y1="16" x2="12" y2="20" />
        </svg>
      );
  }
}

function Sparkle({ className }: { className?: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
    >
      <path
        d="M12 3l1.7 4.4 4.3 1.6-4.3 1.6L12 15l-1.7-4.4L6 9l4.3-1.6L12 3z"
        fill="currentColor"
      />
      <path
        d="M19 14l.9 2.3L22 17l-2.1.7L19 20l-.9-2.3L16 17l2.1-.7L19 14z"
        fill="currentColor"
        opacity="0.6"
      />
    </svg>
  );
}
