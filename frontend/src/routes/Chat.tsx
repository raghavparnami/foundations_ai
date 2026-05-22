import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { streamChat, type ChatMessage } from "../lib/chat";
import ToolCall, { type ToolPart } from "../components/ToolCall";
import TodoPanel from "../components/TodoPanel";
import ChartView, { type ChartSpec, type ChartType } from "../components/ChartView";
import DownloadChip, { type DownloadKind } from "../components/DownloadChip";
import { apiUrl } from "../lib/api";
import SituationRoom from "../features/situation_room/SituationRoom";

type TextPart = { type: "text"; text: string };
type AssistantPart = TextPart | ToolPart;

function isTextPart(p: AssistantPart): p is TextPart {
  return p.type === "text";
}

type Turn =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; parts: AssistantPart[] };

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

  // The Situation Room is now the canonical empty-state surface — no
  // longer flag-gated. The legacy centered greeting + suggestion chips
  // have been removed; see git history (pre-Phase-2) if you need them.
  const empty = turns.length === 0;
  const showSituationRoom = empty;
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
            <SituationRoom onSubmit={(t) => void send(t)} />
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

      {!showSituationRoom && (
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
          </div>
        </form>
      </div>
      )}
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
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                // Chat never renders images. The model occasionally emits
                // ![Chart …](some-url) which becomes a broken icon. Strip it.
                img: () => null,
                a: ({ href, children, ...rest }) => {
                  // Rewrite same-origin /api/* links to the absolute backend
                  // URL so they work when frontend and backend live on
                  // different Railway services.
                  const rewritten =
                    typeof href === "string" && href.startsWith("/api/")
                      ? apiUrl(href)
                      : href;
                  const downloadable =
                    typeof rewritten === "string" &&
                    /\/(download|export)(\?|$)/.test(rewritten);
                  return (
                    <a
                      href={rewritten}
                      target="_blank"
                      rel="noreferrer"
                      {...(downloadable ? { download: "" } : {})}
                      {...rest}
                    >
                      {children}
                    </a>
                  );
                },
              }}
            >
              {p.text}
            </ReactMarkdown>
          </div>
        ) : (
          <ArtifactOrToolCall key={i} part={p} />
        ),
      )}
    </div>
  );
}

function ArtifactOrToolCall({ part }: { part: ToolPart }) {
  const name = part.type.replace(/^tool-/, "").replace(/^dynamic-tool-/, "");
  const done = part.state === "output-available";

  // For chart: render the chart card inline once the tool completes. Use the
  // spec the model already sent as `input.spec` so we don't need a second fetch.
  if (name === "generate_chart" && done) {
    const slug = extractString(part.output, "slug");
    const spec = chartSpecFromInput(part.input);
    if (slug && spec) {
      return <ChartView slug={slug} fallbackSpec={spec} />;
    }
  }

  // For report / presentation: render a download chip.
  if ((name === "generate_report" || name === "generate_presentation") && done) {
    const slug = extractString(part.output, "slug");
    const title =
      extractString(part.output, "title") ||
      extractString(part.input, "title") ||
      slug ||
      "Download";
    const bytes = extractNumber(part.output, "bytes");
    const kind: DownloadKind =
      name === "generate_presentation" ? "presentation" : "report";
    if (slug) {
      return (
        <DownloadChip
          slug={slug}
          kind={kind}
          title={title}
          {...(typeof bytes === "number" ? { bytes } : {})}
        />
      );
    }
  }

  return <ToolCall part={part} />;
}

function extractString(v: unknown, key: string): string | undefined {
  if (v && typeof v === "object" && key in (v as Record<string, unknown>)) {
    const x = (v as Record<string, unknown>)[key];
    if (typeof x === "string") return x;
  }
  return undefined;
}

function extractNumber(v: unknown, key: string): number | undefined {
  if (v && typeof v === "object" && key in (v as Record<string, unknown>)) {
    const x = (v as Record<string, unknown>)[key];
    if (typeof x === "number") return x;
  }
  return undefined;
}

function chartSpecFromInput(input: unknown): ChartSpec | undefined {
  if (!input || typeof input !== "object") return undefined;
  const spec = (input as { spec?: unknown }).spec;
  if (!spec || typeof spec !== "object") return undefined;
  const s = spec as {
    type?: unknown;
    title?: unknown;
    x_field?: unknown;
    y_field?: unknown;
    data?: unknown;
  };
  const type = typeof s.type === "string" ? (s.type as ChartType) : undefined;
  const title = typeof s.title === "string" ? s.title : "";
  const xKey = typeof s.x_field === "string" ? s.x_field : undefined;
  const yKey = typeof s.y_field === "string" ? s.y_field : undefined;
  const data = Array.isArray(s.data)
    ? (s.data as Record<string, string | number>[])
    : undefined;
  if (!type || !xKey || !yKey || !data) return undefined;
  return { type, title, xKey, yKey, data };
}

function WorkingIndicator({ text }: { text: string }) {
  return (
    <div className="text-[12px] text-[var(--text-muted)] flex items-center gap-2">
      <span className="inline-block w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse" />
      <span className="italic">{text}</span>
    </div>
  );
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
