"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import ToolCall, { type ToolPart } from "./ToolCall";
import ChartView from "./ChartView";
import DownloadChip from "./DownloadChip";
import TodoPanel from "./TodoPanel";
import SkillSuggestion from "./SkillSuggestion";

function newSlug(): string {
  return "c-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

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

function WorkingIndicator() {
  const [i, setI] = useState(() => Math.floor(Math.random() * WORKING_LINES.length));
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % WORKING_LINES.length), 2200);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="text-[12px] text-[var(--text-muted)] flex items-center gap-2">
      <span className="inline-block w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse" />
      <span className="italic">{WORKING_LINES[i]}</span>
    </div>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5)  return "Working late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 22) return "Good evening";
  return "Working late";
}

export default function ChatPanel() {
  const router = useRouter();
  const sp = useSearchParams();
  const slug = sp.get("c");

  // First mount with no ?c=: mint a new conversation id and shallow-replace
  // the URL so refresh/share works.
  useEffect(() => {
    if (!slug) {
      const fresh = newSlug();
      router.replace(`/?c=${fresh}`);
    }
  }, [slug, router]);

  if (!slug) return null;
  return <ChatThread key={slug} slug={slug} />;
}

function ChatThread({ slug }: { slug: string }) {
  const [hydrated, setHydrated] = useState<UIMessage[] | null>(null);

  // Pull the persisted messages for this conversation before mounting useChat
  // so the model + UI both start from the right state.
  useEffect(() => {
    let alive = true;
    fetch(`/api/conversations/${slug}/messages`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        setHydrated(Array.isArray(j.messages) ? j.messages : []);
      })
      .catch(() => alive && setHydrated([]));
    return () => {
      alive = false;
    };
  }, [slug]);

  if (hydrated === null) {
    return (
      <div className="flex-1 flex items-center justify-center text-[12px] text-[var(--text-faint)]">
        loading conversation…
      </div>
    );
  }
  return <ChatPane slug={slug} initialMessages={hydrated} />;
}

function ChatPane({ slug, initialMessages }: { slug: string; initialMessages: UIMessage[] }) {
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
      }),
    [],
  );
  const { messages, sendMessage, status, stop } = useChat({
    id: slug,
    messages: initialMessages,
    transport,
  });
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  const isStreaming = status === "streaming" || status === "submitted";

  // Esc stops a running stream. Helpful for keyboard-first users who don't
  // want to take their hands off to click Stop.
  useEffect(() => {
    if (!isStreaming) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        void stop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isStreaming, stop]);

  function submit(text: string) {
    const t = text.trim();
    if (!t) return;
    // Interrupt-then-send: if a stream is running, halt it first and queue
    // the new message as a fresh turn. This is how users "steer mid-chat".
    if (isStreaming) {
      void stop();
    }
    sendMessage({ text: t });
    setInput("");
    inputRef.current?.focus();
  }

  const empty = messages.length === 0;

  const showTodoPanel = !empty;

  return (
    <div className="flex flex-col flex-1 min-h-0 relative">
      <SkillSuggestion conversationId={slug} />
      <div className="flex-1 min-h-0 flex">
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {empty ? (
            <EmptyHero onPick={submit} />
          ) : (
            <div className="px-6 py-6 space-y-5 max-w-[820px] mx-auto w-full">
              {messages.map((m) => (
                <MessageBubble key={m.id} m={m} />
              ))}
              {isStreaming && <WorkingIndicator />}
            </div>
          )}
        </div>
        {showTodoPanel && (
          <aside className="hidden xl:flex w-[280px] shrink-0 border-l border-[var(--border)] bg-[var(--bg-soft)]">
            <TodoPanel messages={messages} isStreaming={isStreaming} />
          </aside>
        )}
      </div>

      <div className="px-6 pb-6 pt-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
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
                  isStreaming
                    ? "Type to redirect — interrupts the current answer…"
                    : "Initiate a query or send a command to Loom…"
                }
                className="flex-1 bg-transparent text-[14px] text-[var(--text)] placeholder:text-[var(--text-faint)] outline-none"
              />
              {isStreaming && !input.trim() && (
                <button
                  type="button"
                  onClick={() => void stop()}
                  className="flex items-center gap-1.5 text-[var(--text)] text-[13px] font-medium px-3 py-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-elev)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition"
                  title="Stop generating (Esc)"
                >
                  <span
                    aria-hidden
                    style={{ width: 10, height: 10, borderRadius: 2, background: "var(--accent)" }}
                  />
                  Stop
                </button>
              )}
              {isStreaming && input.trim() && (
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
              {!isStreaming && (
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
                <ActionChip iconName="bar" label="Run analysis" onClick={() => submit(SUGGESTIONS[0]!)} />
                <ActionChip iconName="chart" label="Generate chart" onClick={() => submit("Plot a chart of deviation rate by line for the last 30 days.")} />
                <ActionChip iconName="doc" label="Write a report" onClick={() => submit("Write an executive summary report of yesterday's quality metrics.")} />
                <ActionChip iconName="deck" label="Build a deck" onClick={() => submit("Build a 5-slide deck for the ops VP about this week's deviation hotspots.")} />
              </div>
            )}
          </div>
        </form>
      </div>
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
  href,
}: {
  iconName: "bar" | "chart" | "doc" | "deck";
  label: string;
  onClick?: () => void;
  href?: string;
}) {
  const content = (
    <>
      <ChipIcon name={iconName} />
      {label}
    </>
  );
  if (href) return <a href={href} className="action-chip">{content}</a>;
  return (
    <button type="button" onClick={onClick} className="action-chip">
      {content}
    </button>
  );
}

function ChipIcon({ name }: { name: "bar" | "chart" | "doc" | "deck" }) {
  const props = {
    width: 14, height: 14, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: 1.6,
    strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "bar":   return <svg {...props}><path d="M3 21V9"/><path d="M9 21V3"/><path d="M15 21v-9"/><path d="M21 21V6"/></svg>;
    case "chart": return <svg {...props}><polyline points="3 17 9 11 13 15 21 7"/><polyline points="14 7 21 7 21 14"/></svg>;
    case "doc":   return <svg {...props}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
    case "deck":  return <svg {...props}><rect x="3" y="4" width="18" height="12" rx="1"/><line x1="8" y1="20" x2="16" y2="20"/><line x1="12" y1="16" x2="12" y2="20"/></svg>;
  }
}

function Sparkle({ className }: { className?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
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

function MessageBubble({ m }: { m: UIMessage }) {
  if (m.role === "user") {
    const text = (m.parts ?? []).map((p) => (p.type === "text" ? p.text : "")).join("");
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-[var(--user-bg)] border border-[var(--user-border)] rounded-2xl px-4 py-2.5 text-sm text-[var(--text)] whitespace-pre-wrap">
          {text}
        </div>
      </div>
    );
  }
  if (m.role !== "assistant") return null;

  return (
    <div className="space-y-2">
      {(m.parts ?? []).map((p, i) => {
        if (p.type === "text") {
          return (
            <div key={i} className="markdown-doc text-sm">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{p.text}</ReactMarkdown>
            </div>
          );
        }
        if (typeof p.type === "string" && p.type.startsWith("tool-")) {
          const tp = p as ToolPart;
          const out = tp.output as
            | { ok?: boolean; slug?: string; title?: string; download_url?: string; bytes?: number; type?: string }
            | undefined;
          // AI SDK v6 marks a finished tool call as state="output-available".
          // (Older "result" naming is gone — that miss is why charts used to
          // render as raw JSON.)
          const finished = tp.state === "output-available" || tp.state === "result";
          if (finished && out && out.ok && out.slug) {
            if (p.type === "tool-generate_chart") {
              return <ChartView key={i} slug={out.slug} />;
            }
            if (p.type === "tool-generate_report" && out.download_url) {
              return (
                <DownloadChip
                  key={i}
                  href={out.download_url}
                  title={out.title ?? out.slug}
                  kind="report"
                  bytes={out.bytes}
                />
              );
            }
            if (p.type === "tool-generate_presentation" && out.download_url) {
              return (
                <DownloadChip
                  key={i}
                  href={out.download_url}
                  title={out.title ?? out.slug}
                  kind="presentation"
                  bytes={out.bytes}
                />
              );
            }
          }
          return <ToolCall key={i} part={tp} />;
        }
        return null;
      })}
    </div>
  );
}
