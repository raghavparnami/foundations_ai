/**
 * The Loom Terminal · home view.
 *
 * Mono-font, dark, single-column scrolling pane. Every event from the
 * /api/converse SSE stream becomes a Claude-Code-style tool block:
 *
 *   ⏺ Plan
 *     ⎿ ☒ Convene IRIS, Mason
 *       ☐ IRIS · drafting
 *       ☐ Mason · pending
 *       ☐ Synthesize
 *
 *   ⏺ IRIS(deliberate · IIoT)
 *     ⎿ Vibration on Pump 7 is 3.2σ above baseline …
 *
 *   ⏺ Synthesize
 *     ⎿ All agree: pull Pump 7 within 36hr.
 *
 *   ─────────────────────────────────
 *   done · 14.2s · 4 LLM calls · $0.0024
 *
 * Slash commands at the prompt: /marcus, /iris, /audit, /handoff …
 */
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { streamConverse } from "../converse/stream";
import type { ConverseEvent } from "../converse/types";
import { getPersona } from "../situation_room/fixtures";
import { useAllPersonas } from "../situation_room/useCustomPersonas";
import { useCostMeter } from "../situation_room/useCostMeter";
import SMEDetailDrawer from "../converse/SMEDetailDrawer";
import NewSMEModal from "../situation_room/NewSMEModal";
import type { SMEPersona } from "../situation_room/types";
import "./terminal.css";

// ─── event types we render in the stream ─────────────────────────────

type TodoStatus = "pending" | "running" | "done";
type Todo = { text: string; status: TodoStatus };

type Block =
  | { kind: "user"; id: string; text: string }
  | { kind: "plan"; id: string; todos: Todo[] }
  | { kind: "sme"; id: string; sme_id: string; text: string; running: boolean; errored: boolean }
  | { kind: "loom"; id: string; text: string; running: boolean }
  | { kind: "synth"; id: string; consensus: string; dissenters: { sme_id: string; reason: string }[] }
  | { kind: "meta"; id: string; duration_ms: number; cost_usd: number; llm_calls: number }
  | { kind: "err"; id: string; message: string };

// ─── slash commands ───────────────────────────────────────────────────

type Slash = { cmd: string; desc: string; expand: (rest: string) => string | null };

function buildSlash(personas: SMEPersona[]): Slash[] {
  const items: Slash[] = personas.map((p) => ({
    cmd: `/${p.id}`,
    desc: `Ask ${p.name} (${p.role}) directly`,
    expand: (rest: string) => (rest.trim() ? `@${p.name} ${rest.trim()}` : null),
  }));
  items.push(
    { cmd: "/audit", desc: "Audit unresolved critical deviations",
      expand: () => "Summarise unresolved critical deviations and who should act." },
    { cmd: "/handoff", desc: "Draft a shift handoff note",
      expand: () => "Draft a shift handoff note for the next operator." },
    { cmd: "/diagnose", desc: "Diagnose equipment / line issue",
      expand: (rest: string) => rest.trim() ? `Diagnose: ${rest.trim()}` : "Diagnose the most concerning equipment right now." },
    { cmd: "/rank", desc: "Rank lines or equipment",
      expand: (rest: string) => rest.trim() ? `Rank ${rest.trim()}` : "Rank production lines by 30-day OEE." },
    { cmd: "/clear", desc: "Clear the terminal",
      expand: () => "__CLEAR__" },
    { cmd: "/help", desc: "Show all commands",
      expand: () => "__HELP__" },
  );
  return items;
}

// ─── main component ──────────────────────────────────────────────────

export default function Terminal() {
  const { personas, refresh: refreshPersonas } = useAllPersonas();
  const meter = useCostMeter();
  const slash = useMemo(() => buildSlash(personas), [personas]);

  const [blocks, setBlocks] = useState<Block[]>([]);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [drawerSme, setDrawerSme] = useState<SMEPersona | null>(null);
  const [showNewSme, setShowNewSme] = useState(false);

  const streamRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-scroll
  useEffect(() => {
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: "smooth" });
  }, [blocks.length, busy]);

  // Hotkeys
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (busy && e.key === "Escape" && !showSlash) {
        e.preventDefault();
        stop();
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  // Slash menu state
  const showSlash = input.startsWith("/") && !input.includes("\n");
  const slashQuery = showSlash ? input.split(" ")[0]!.slice(1).toLowerCase() : "";
  const slashMatches = useMemo(() => {
    if (!showSlash) return [];
    if (!slashQuery) return slash.slice(0, 8);
    return slash.filter((s) => s.cmd.slice(1).toLowerCase().startsWith(slashQuery)).slice(0, 8);
  }, [showSlash, slashQuery, slash]);
  const [slashIdx, setSlashIdx] = useState(0);
  useEffect(() => setSlashIdx(0), [slashQuery]);

  function pushBlock(b: Block) {
    setBlocks((bs) => [...bs, b]);
  }
  function mutateBlock(id: string, fn: (b: Block) => Block) {
    setBlocks((bs) => bs.map((b) => (b.id === id ? fn(b) : b)));
  }

  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  }

  async function execute(rawText: string) {
    if (!rawText.trim()) return;

    // Slash-command expansion BEFORE sending
    let text = rawText.trim();
    if (text.startsWith("/")) {
      const head = text.split(" ")[0]!;
      const rest = text.slice(head.length).trim();
      const cmd = slash.find((s) => s.cmd === head);
      if (cmd) {
        const expanded = cmd.expand(rest);
        if (expanded === "__CLEAR__") { setBlocks([]); return; }
        if (expanded === "__HELP__") {
          pushBlock({
            kind: "user", id: rid(), text,
          });
          pushBlock({
            kind: "loom", id: rid(), text: helpText(slash), running: false,
          });
          return;
        }
        if (expanded === null) { return; } // need args (e.g. /marcus with no question)
        text = expanded;
      }
    }

    const ctrl = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ctrl;
    setBusy(true);
    setInput("");

    const planId = rid();
    const planTodos: Todo[] = [{ text: "Routing the question", status: "running" }];
    let hasPlan = false;

    const speechIds = new Map<string, string>();

    try {
      for await (const ev of streamConverse({ question: text }, ctrl.signal)) {
        handle(ev);
      }
    } catch (e) {
      if (!ctrl.signal.aborted) {
        pushBlock({ kind: "err", id: rid(), message: (e as Error).message });
      }
    } finally {
      if (abortRef.current === ctrl) {
        abortRef.current = null;
        setBusy(false);
      }
      // Close any still-running blocks defensively
      setBlocks((bs) =>
        bs.map((b) => {
          if (b.kind === "sme" && b.running) return { ...b, running: false };
          if (b.kind === "loom" && b.running) return { ...b, running: false };
          if (b.kind === "plan") return { ...b, todos: b.todos.map((t) => t.status === "running" ? { ...t, status: "done" as const } : t) };
          return b;
        }),
      );
    }

    function handle(ev: ConverseEvent) {
      switch (ev.type) {
        case "user_message": {
          pushBlock({ kind: "user", id: rid(), text: ev.text });
          // Insert the plan block right after — initially with one entry
          pushBlock({ kind: "plan", id: planId, todos: planTodos });
          return;
        }
        case "handshake": {
          hasPlan = true;
          const newTodos: Todo[] = [
            { text: `Convene ${ev.smes.map((s) => getPersona(s)?.name ?? s).join(", ")}`, status: "done" },
            ...ev.smes.map((s) => ({
              text: `${getPersona(s)?.name ?? s} · drafting`,
              status: "pending" as TodoStatus,
            })),
            { text: "Synthesize consensus", status: "pending" },
            { text: "Loom wraps up", status: "pending" },
          ];
          mutateBlock(planId, (b) =>
            b.kind === "plan" ? { ...b, todos: newTodos } : b,
          );
          return;
        }
        case "sme_start": {
          // Mark this SME's plan row as running
          markTodo((t) => t.text.startsWith((getPersona(ev.sme_id)?.name ?? ev.sme_id) + " "), "running");
          const id = rid();
          speechIds.set("sme:" + ev.sme_id, id);
          pushBlock({
            kind: "sme",
            id,
            sme_id: ev.sme_id,
            text: "",
            running: true,
            errored: false,
          });
          return;
        }
        case "sme_delta": {
          const id = speechIds.get("sme:" + ev.sme_id);
          if (!id) return;
          mutateBlock(id, (b) =>
            b.kind === "sme" ? { ...b, text: b.text + ev.text } : b,
          );
          return;
        }
        case "sme_done": {
          const id = speechIds.get("sme:" + ev.sme_id);
          if (id) {
            mutateBlock(id, (b) => (b.kind === "sme" ? { ...b, running: false } : b));
          }
          markTodo((t) => t.text.startsWith((getPersona(ev.sme_id)?.name ?? ev.sme_id) + " "), "done");
          return;
        }
        case "synthesis": {
          markTodo((t) => t.text === "Synthesize consensus", "done");
          pushBlock({
            kind: "synth",
            id: rid(),
            consensus: ev.consensus_summary,
            dissenters: ev.dissenters,
          });
          return;
        }
        case "agent_speak": {
          const key = "loom";
          let id = speechIds.get(key);
          if (!id) {
            if (hasPlan) {
              markTodo((t) => t.text === "Loom wraps up", "running");
            }
            id = rid();
            speechIds.set(key, id);
            pushBlock({
              kind: "loom",
              id,
              text: ev.text,
              running: true,
            });
          } else {
            const sid = id;
            mutateBlock(sid, (b) =>
              b.kind === "loom" ? { ...b, text: b.text + ev.text } : b,
            );
          }
          return;
        }
        case "turn_done": {
          const id = speechIds.get("loom");
          if (id) mutateBlock(id, (b) => (b.kind === "loom" ? { ...b, running: false } : b));
          if (hasPlan) markTodo((t) => t.text === "Loom wraps up", "done");
          pushBlock({
            kind: "meta",
            id: rid(),
            duration_ms: ev.duration_ms,
            cost_usd: ev.cost_usd,
            llm_calls: ev.llm_calls,
          });
          return;
        }
        case "error": {
          pushBlock({ kind: "err", id: rid(), message: ev.message });
          return;
        }
      }
    }

    function markTodo(pred: (t: Todo) => boolean, status: TodoStatus) {
      mutateBlock(planId, (b) => {
        if (b.kind !== "plan") return b;
        return {
          ...b,
          todos: b.todos.map((t) => (pred(t) ? { ...t, status } : t)),
        };
      });
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (showSlash && slashMatches.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSlashIdx((i) => Math.min(slashMatches.length - 1, i + 1)); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setSlashIdx((i) => Math.max(0, i - 1)); return; }
      if (e.key === "Tab" || (e.key === "Enter" && !input.includes(" "))) {
        e.preventDefault();
        const sel = slashMatches[slashIdx];
        if (sel) {
          // Replace the slash token, leave the rest of the line.
          const rest = input.slice(input.split(" ")[0]!.length);
          setInput(sel.cmd + (rest || " "));
          requestAnimationFrame(() => inputRef.current?.focus());
        }
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void execute(input);
    }
  }

  return (
    <main className="lt-root">
      <header className="lt-topbar">
        <div className="lt-topbar__brand">
          <b>loom</b>
          <span className="lt-topbar__path">  ~/{personas.length}-experts</span>
        </div>
        <div className="lt-topbar__meta">
          {meter && (
            <>
              ${meter.total.cost_usd.toFixed(4)} · {meter.total.calls} calls
              {" · "}deepseek-v3.1
            </>
          )}
        </div>
      </header>

      <div className="lt-stream" ref={streamRef}>
        {blocks.length === 0 && (
          <div className="lt-stream__welcome">
            <b>loom</b> · multi-expert orchestrator
            {"\n"}─────────────────────────────
            {"\n"}type a question, or start with <b>/</b> for a command
            {"\n"}{"\n"}available: {personas.map((p) => `/${p.id}`).join("  ")}
            {"\n"}also:      /audit  /handoff  /diagnose  /rank  /help
            {"\n"}{"\n"}hotkeys:  enter send · shift+enter newline · ⌘K focus · esc stop
            <span className="lt-topbar__cursor" />
          </div>
        )}
        {blocks.map((b) => renderBlock(b, { busy, onPersonaClick: setDrawerSme }))}
      </div>

      <div className="lt-input">
        {showSlash && slashMatches.length > 0 && (
          <div className="lt-slash" role="listbox" aria-label="Slash commands">
            <div className="lt-slash__label">Commands · ↑↓ navigate · Tab insert</div>
            {slashMatches.map((s, i) => (
              <div
                key={s.cmd}
                className={"lt-slash__item " + (i === slashIdx ? "lt-slash__item--active" : "")}
                onMouseDown={(e) => {
                  e.preventDefault();
                  const rest = input.slice(input.split(" ")[0]!.length);
                  setInput(s.cmd + (rest || " "));
                  inputRef.current?.focus();
                }}
              >
                <span className="lt-slash__cmd">{s.cmd}</span>
                <span className="lt-slash__desc">{s.desc}</span>
              </div>
            ))}
          </div>
        )}
        <span className="lt-input__chev" aria-hidden>❯</span>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            busy
              ? "running... type to redirect"
              : "ask anything, or / for commands"
          }
          rows={1}
          autoFocus
          className="lt-input__textarea"
        />
        <span className="lt-input__hints">
          {busy ? "esc to stop" : "enter to run · / for commands"}
        </span>
      </div>

      {drawerSme && (
        <SMEDetailDrawer
          persona={drawerSme}
          spend={meter?.by_sme?.[drawerSme.id] ?? null}
          calibration={null}
          onClose={() => setDrawerSme(null)}
          onDeleted={() => void refreshPersonas()}
        />
      )}
      {showNewSme && (
        <NewSMEModal
          onClose={() => setShowNewSme(false)}
          onCreated={() => void refreshPersonas()}
        />
      )}
    </main>
  );
}

// ─── per-block renderer ──────────────────────────────────────────────

type RenderOpts = {
  busy: boolean;
  onPersonaClick: (p: SMEPersona) => void;
};

function renderBlock(b: Block, opts: RenderOpts) {
  if (b.kind === "user") {
    return (
      <div key={b.id} className="lt-user">
        <span className="lt-user__chev">❯</span>
        <span className="lt-user__text">{b.text}</span>
      </div>
    );
  }

  if (b.kind === "plan") {
    const remaining = b.todos.filter((t) => t.status !== "done").length;
    return (
      <div key={b.id} className="lt-tool">
        <div className="lt-tool__head">
          <span className={"lt-tool__dot " + (remaining === 0 ? "lt-tool__dot--ok" : "lt-tool__dot--run")}>⏺</span>
          <span className="lt-tool__label">Plan</span>
          <span className="lt-tool__args">({b.todos.length - remaining}/{b.todos.length} done)</span>
        </div>
        <div className="lt-todo">
          {b.todos.map((t, i) => {
            const mark = t.status === "done" ? "☒" : t.status === "running" ? "◐" : "☐";
            const markCls = t.status === "done" ? "lt-todo__mark--ok"
              : t.status === "running" ? "lt-todo__mark--run"
              : "lt-todo__mark--pending";
            const txtCls = t.status === "done" ? "lt-todo__text--ok"
              : t.status === "running" ? "lt-todo__text--run"
              : "";
            return (
              <div key={i} className="lt-todo__row">
                <span className={"lt-todo__mark " + markCls}>{mark}</span>
                <span className={"lt-todo__text " + txtCls}>{t.text}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (b.kind === "sme") {
    const p = getPersona(b.sme_id);
    const label = p?.name ?? b.sme_id;
    const role = p?.role ?? "";
    const fg = p?.color.fg ?? "var(--lt-accent)";
    const dot = b.errored ? "lt-tool__dot--err" : b.running ? "lt-tool__dot--run" : "lt-tool__dot--ok";
    return (
      <div key={b.id} className="lt-tool">
        <div
          className="lt-tool__head"
          onClick={() => p && opts.onPersonaClick(p)}
          style={{ cursor: p ? "pointer" : "default" }}
        >
          <span className={"lt-tool__dot " + dot} style={!b.running && !b.errored ? { color: fg } : undefined}>⏺</span>
          <span className="lt-tool__label-persona" style={{ color: fg }}>
            {label}
          </span>
          <span className="lt-tool__args">(deliberate{role ? " · " + role : ""})</span>
        </div>
        <div className="lt-tool__output">
          <span className="lt-tool__corner">⎿</span>
          <div className="lt-tool__body">
            {b.text ? (
              <div className="markdown-doc">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: () => null }}>
                  {b.text}
                </ReactMarkdown>
              </div>
            ) : (
              <span className="lt-tool__body--mute">…</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (b.kind === "loom") {
    const dot = b.running ? "lt-tool__dot--run" : "lt-tool__dot--ok";
    return (
      <div key={b.id} className="lt-tool">
        <div className="lt-tool__head">
          <span className={"lt-tool__dot " + dot}>⏺</span>
          <span className="lt-tool__label">Loom</span>
          <span className="lt-tool__args">(wrap-up)</span>
        </div>
        <div className="lt-tool__output">
          <span className="lt-tool__corner">⎿</span>
          <div className="lt-tool__body">
            {b.text ? (
              <div className="markdown-doc">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: () => null }}>
                  {b.text}
                </ReactMarkdown>
              </div>
            ) : (
              <span className="lt-tool__body--mute">…</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (b.kind === "synth") {
    return (
      <div key={b.id} className="lt-tool">
        <div className="lt-tool__head">
          <span className="lt-tool__dot lt-tool__dot--ok">⏺</span>
          <span className="lt-tool__label">Synthesize</span>
          <span className="lt-tool__args">(consensus)</span>
        </div>
        <div className="lt-tool__output">
          <span className="lt-tool__corner">⎿</span>
          <div className="lt-tool__body">
            {b.consensus || "—"}
            {b.dissenters.length > 0 && (
              <div style={{ marginTop: 4, color: "var(--lt-warn)" }}>
                {b.dissenters.map((d) => {
                  const p = getPersona(d.sme_id);
                  return (
                    <div key={d.sme_id}>
                      ⚠ <b style={{ color: p?.color.fg }}>{p?.name ?? d.sme_id}</b> dissents: {d.reason}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (b.kind === "meta") {
    return (
      <div key={b.id} className="lt-meta">
        ─ done · {(b.duration_ms / 1000).toFixed(1)}s · {b.llm_calls} LLM call
        {b.llm_calls === 1 ? "" : "s"} · ${b.cost_usd.toFixed(4)}
      </div>
    );
  }

  if (b.kind === "err") {
    return <div key={b.id} className="lt-err">⚠ {b.message}</div>;
  }
  return null;
}

function rid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function helpText(slash: Slash[]): string {
  const lines = ["available commands:", ""];
  for (const s of slash) {
    lines.push(`  ${s.cmd.padEnd(14)} ${s.desc}`);
  }
  lines.push("");
  lines.push("type any free-text question to convene the right SMEs automatically.");
  return lines.join("\n");
}
