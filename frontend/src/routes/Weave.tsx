/**
 * The Weave · new home. Loom's name made literal.
 *
 * Vertical persistent warp threads (one per SME) run down the canvas.
 * Time flows top-down. User questions are horizontal wefts; SME
 * contributions land in their own warp column; synthesis is a ribbon
 * spanning the speaking columns; Loom wraps up at the bottom of the
 * weft. No avatars-in-a-list, no bubbles, no chat.
 *
 * State machinery mirrors Converse — same /api/converse SSE stream,
 * same persona model. Visualisation is the only thing that's different.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { streamConverse } from "../features/converse/stream";
import type {
  ConverseEvent,
  TranscriptItem,
} from "../features/converse/types";
import WeaveTurn from "../features/weave/WeaveTurn";
import SMEDetailDrawer from "../features/converse/SMEDetailDrawer";
import NewSMEModal from "../features/situation_room/NewSMEModal";
import { SMEIcon } from "../features/situation_room/icons";
import { useAllPersonas } from "../features/situation_room/useCustomPersonas";
import { useCalibration } from "../features/situation_room/useCalibration";
import { useCostMeter, formatUsd } from "../features/situation_room/useCostMeter";
import type { SMEPersona } from "../features/situation_room/types";
import "../features/weave/weave.css";

type Turn = {
  id: string;
  items: TranscriptItem[];
};

export default function Weave() {
  const { personas, refresh: refreshPersonas } = useAllPersonas();
  const calibration = useCalibration();
  const meter = useCostMeter();

  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [liveCostUsd, setLiveCostUsd] = useState(0);
  const [drawerSme, setDrawerSme] = useState<SMEPersona | null>(null);
  const [showNewSme, setShowNewSme] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState("");

  const threadIds = useMemo(() => personas.map((p) => p.id), [personas]);

  // Active set for thread highlighting: anyone streaming in the latest turn.
  const activeSmes = useMemo(() => {
    const set = new Set<string>();
    if (!busy || turns.length === 0) return set;
    const last = turns[turns.length - 1];
    if (!last) return set;
    for (const it of last.items) {
      if (it.kind === "speech" && it.speaker.kind === "sme" && !it.done) {
        set.add(it.speaker.sme_id);
      }
    }
    return set;
  }, [turns, busy]);

  const send = useCallback(
    async (text: string) => {
      const ctrl = new AbortController();
      abortRef.current?.abort();
      abortRef.current = ctrl;
      setBusy(true);

      const turnId = cryptoRandom();
      const speechIds = new Map<string, string>();

      setTurns((prev) => [...prev, { id: turnId, items: [] }]);

      function appendItem(item: TranscriptItem) {
        setTurns((prev) =>
          prev.map((t) =>
            t.id === turnId ? { ...t, items: [...t.items, item] } : t,
          ),
        );
      }
      function mutateItem(itemId: string, fn: (it: TranscriptItem) => TranscriptItem) {
        setTurns((prev) =>
          prev.map((t) =>
            t.id === turnId
              ? {
                  ...t,
                  items: t.items.map((it) => (it.id === itemId ? fn(it) : it)),
                }
              : t,
          ),
        );
      }

      try {
        for await (const ev of streamConverse({ question: text }, ctrl.signal)) {
          handle(ev);
        }
      } catch (e) {
        if (!ctrl.signal.aborted) {
          appendItem({
            id: cryptoRandom(),
            kind: "error",
            msg_id: "",
            message: (e as Error).message,
          });
        }
      } finally {
        if (abortRef.current === ctrl) {
          abortRef.current = null;
          setBusy(false);
        }
      }

      function handle(ev: ConverseEvent) {
        switch (ev.type) {
          case "user_message": {
            const id = cryptoRandom();
            appendItem({
              id,
              kind: "speech",
              speaker: { kind: "user" },
              text: ev.text,
              started_at: Date.now(),
              done: true,
            });
            return;
          }
          case "agent_speak": {
            const key = "loom:" + ev.msg_id;
            let id = speechIds.get(key);
            if (!id) {
              id = cryptoRandom();
              speechIds.set(key, id);
              appendItem({
                id,
                kind: "speech",
                speaker: { kind: "loom" },
                text: ev.text,
                started_at: Date.now(),
                done: false,
              });
            } else {
              const sid = id;
              mutateItem(sid, (s) =>
                s.kind === "speech" ? { ...s, text: s.text + ev.text } : s,
              );
            }
            return;
          }
          case "handshake": {
            appendItem({
              id: cryptoRandom(),
              kind: "handshake",
              msg_id: ev.msg_id,
              smes: ev.smes,
              reason: ev.reason,
            });
            return;
          }
          case "sme_start": {
            const key = "sme:" + ev.sme_id;
            if (speechIds.has(key)) return;
            const id = cryptoRandom();
            speechIds.set(key, id);
            appendItem({
              id,
              kind: "speech",
              speaker: { kind: "sme", sme_id: ev.sme_id },
              text: "",
              started_at: Date.now(),
              done: false,
            });
            return;
          }
          case "sme_delta": {
            const key = "sme:" + ev.sme_id;
            const id = speechIds.get(key);
            if (!id) return;
            mutateItem(id, (s) =>
              s.kind === "speech" ? { ...s, text: s.text + ev.text } : s,
            );
            return;
          }
          case "sme_done": {
            const key = "sme:" + ev.sme_id;
            const id = speechIds.get(key);
            if (!id) return;
            mutateItem(id, (s) => (s.kind === "speech" ? { ...s, done: true } : s));
            return;
          }
          case "synthesis": {
            appendItem({
              id: cryptoRandom(),
              kind: "synthesis",
              msg_id: ev.msg_id,
              consensus_summary: ev.consensus_summary,
              dissenters: ev.dissenters,
            });
            return;
          }
          case "turn_done": {
            // mark all open speeches done
            setTurns((prev) =>
              prev.map((t) =>
                t.id !== turnId
                  ? t
                  : {
                      ...t,
                      items: t.items.map((it) =>
                        it.kind === "speech" && !it.done ? { ...it, done: true } : it,
                      ),
                    },
              ),
            );
            appendItem({
              id: cryptoRandom(),
              kind: "meta",
              msg_id: ev.msg_id,
              duration_ms: ev.duration_ms,
              cost_usd: ev.cost_usd,
              llm_calls: ev.llm_calls,
            });
            setLiveCostUsd((c) => c + ev.cost_usd);
            return;
          }
          case "error": {
            appendItem({
              id: cryptoRandom(),
              kind: "error",
              msg_id: ev.msg_id,
              message: ev.message,
            });
            return;
          }
        }
      }
    },
    [],
  );

  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  }

  function submit() {
    const t = input.trim();
    if (!t) return;
    setInput("");
    void send(t);
  }

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (busy && e.key === "Escape") {
        e.preventDefault();
        stop();
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [busy]);

  const empty = turns.length === 0;

  return (
    <main className="weave-root">
      {/* Add SME floating button */}
      <button
        type="button"
        className="weave-add-sme"
        onClick={() => setShowNewSme(true)}
      >
        <span aria-hidden>+</span> add thread
      </button>

      {/* Header — the warp labels */}
      <header className="weave-header">
        <div className="weave-header__label">
          <span>
            Loom · {personas.length} threads
            {meter && (
              <>
                {" · "}
                <span style={{ color: "var(--text-muted)" }}>
                  {formatUsd(meter.total.cost_usd)} · {meter.total.calls} calls
                </span>
              </>
            )}
          </span>
        </div>
        <div
          className="weave-header__threads"
          style={{ gridTemplateColumns: `repeat(${threadIds.length}, 1fr)` }}
        >
          {personas.map((p) => {
            const active = activeSmes.has(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setDrawerSme(p)}
                className={
                  "weave-thread-label " +
                  (active ? "weave-thread-label--active" : "")
                }
                style={{ color: active ? p.color.fg : undefined }}
                title={`${p.name} · ${p.role}\n${p.domain.join(", ")}`}
              >
                <span
                  className="weave-thread-label__pip"
                  style={{
                    background: active ? p.color.bg : "var(--bg-soft)",
                    boxShadow: active
                      ? `0 0 0 1px ${p.color.fg}55, 0 0 8px ${p.color.fg}80`
                      : "none",
                    color: active ? p.color.fg : "var(--text-muted)",
                  }}
                >
                  <SMEIcon name={p.icon} size={11} />
                </span>
                <span className="weave-thread-label__name">{p.name}</span>
                {active && (
                  <span
                    className="weave-thread-label__pulse"
                    style={{ background: p.color.fg }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </header>

      {/* Canvas */}
      <div className="weave-canvas">
        {/* Warp lines as positioned grid background */}
        <div
          className="weave-canvas__warps"
          style={{ gridTemplateColumns: `repeat(${threadIds.length}, 1fr)` }}
        >
          {personas.map((p) => {
            const active = activeSmes.has(p.id);
            return (
              <div
                key={p.id}
                className={"weave-warp " + (active ? "weave-warp--alive" : "")}
                style={
                  active
                    ? ({
                        ["--weave-warp-active" as string]: p.color.fg,
                      } as React.CSSProperties)
                    : undefined
                }
              />
            );
          })}
        </div>

        {empty ? (
          <EmptyHero />
        ) : (
          <div className="weave-turns">
            {turns.map((t, i) => (
              <WeaveTurn
                key={t.id}
                items={t.items}
                threadIds={threadIds}
                busy={busy && i === turns.length - 1}
                isFirst={i === 0}
              />
            ))}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="weave-composer">
        <div style={{ width: "100%", maxWidth: 720, margin: "0 auto" }}>
          <div className="weave-composer__bar">
            <span className="weave-composer__caret" aria-hidden>
              ❯
            </span>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={1}
              autoFocus
              placeholder={
                busy
                  ? "weaving in progress · type to redirect"
                  : "weave a question — @Marcus to pick one thread"
              }
              className="weave-composer__input"
            />
            {liveCostUsd > 0 && (
              <span className="weave-composer__cost">
                ${liveCostUsd.toFixed(4)}
              </span>
            )}
            {busy && (
              <button
                type="button"
                onClick={stop}
                style={{
                  fontSize: 11,
                  padding: "4px 10px",
                  borderRadius: 999,
                  background: "var(--bg-soft)",
                  border: "0.5px solid var(--color-border-tertiary)",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                }}
              >
                Stop
              </button>
            )}
          </div>
          <div className="weave-composer__hint">
            Enter to weave · Shift+Enter newline · ⌘K focus · click a thread to teach
          </div>
        </div>
      </div>

      {drawerSme && (
        <SMEDetailDrawer
          persona={drawerSme}
          spend={meter?.by_sme?.[drawerSme.id] ?? null}
          calibration={calibration[drawerSme.id] ?? null}
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

function EmptyHero() {
  return (
    <div className="weave-empty">
      <div className="weave-empty__title">A loom for your team's thinking</div>
      <div className="weave-empty__sub">
        Each thread above is an SME. Ask anything below — Loom decides which
        threads to weave together. Synthesis happens in real time.
      </div>
    </div>
  );
}

function cryptoRandom(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
