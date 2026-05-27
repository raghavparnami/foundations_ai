/**
 * Slide-out result panel · structured report, not a chat thread.
 *
 * Receives the same /api/converse SSE stream but renders as:
 *   - Question header
 *   - Big Consensus card (always at the top — the punch line first)
 *   - Per-SME accordion cards (collapsed by default, expand on click)
 *   - Loom wrap-up at the bottom
 *   - Meta line (duration, calls, cost)
 *
 * Closes when the user clicks the X / overlay / Esc.
 */
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { streamConverse } from "../converse/stream";
import { getPersona } from "../situation_room/fixtures";
import { SMEIcon } from "../situation_room/icons";

type SmeAnswer = {
  sme_id: string;
  text: string;
  done: boolean;
};

type Synth = {
  consensus_summary: string;
  dissenters: { sme_id: string; reason: string }[];
};

type Meta = { duration_ms: number; cost_usd: number; llm_calls: number };

type Props = {
  question: string;
  onClose: () => void;
};

export default function ResultPanel({ question, onClose }: Props) {
  const [smes, setSmes] = useState<Map<string, SmeAnswer>>(new Map());
  const [synth, setSynth] = useState<Synth | null>(null);
  const [loom, setLoom] = useState("");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [handshakeReason, setHandshakeReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);

    (async () => {
      try {
        for await (const ev of streamConverse({ question }, ctrl.signal)) {
          if (ev.type === "handshake") {
            setHandshakeReason(ev.reason || null);
          } else if (ev.type === "sme_start") {
            setSmes((m) => {
              if (m.has(ev.sme_id)) return m;
              const next = new Map(m);
              next.set(ev.sme_id, { sme_id: ev.sme_id, text: "", done: false });
              return next;
            });
          } else if (ev.type === "sme_delta") {
            setSmes((m) => {
              const cur = m.get(ev.sme_id);
              if (!cur) return m;
              const next = new Map(m);
              next.set(ev.sme_id, { ...cur, text: cur.text + ev.text });
              return next;
            });
          } else if (ev.type === "sme_done") {
            setSmes((m) => {
              const cur = m.get(ev.sme_id);
              if (!cur) return m;
              const next = new Map(m);
              next.set(ev.sme_id, { ...cur, done: true });
              return next;
            });
          } else if (ev.type === "synthesis") {
            setSynth({
              consensus_summary: ev.consensus_summary,
              dissenters: ev.dissenters,
            });
          } else if (ev.type === "agent_speak") {
            setLoom((l) => l + ev.text);
          } else if (ev.type === "turn_done") {
            setMeta({
              duration_ms: ev.duration_ms,
              cost_usd: ev.cost_usd,
              llm_calls: ev.llm_calls,
            });
          } else if (ev.type === "error") {
            setError(ev.message);
          }
        }
      } catch (e) {
        if (!ctrl.signal.aborted) setError((e as Error).message);
      } finally {
        if (abortRef.current === ctrl) {
          abortRef.current = null;
        }
        setBusy(false);
      }
    })();

    return () => ctrl.abort();
  }, [question]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  function toggle(id: string) {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const smesList = Array.from(smes.values());
  // Auto-expand the first SME when it starts streaming.
  useEffect(() => {
    if (smesList.length === 1 && expanded.size === 0) {
      setExpanded(new Set([smesList[0]!.sme_id]));
    }
  }, [smesList.length, expanded.size, smesList]);

  return (
    <div
      className="result-panel__backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <aside
        className="result-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="result-panel__head">
          <span className="result-panel__head-mark" aria-hidden />
          <div className="result-panel__head-question">
            {question}
            <div className="result-panel__head-meta">
              {busy
                ? "running…"
                : meta
                  ? `done · ${(meta.duration_ms / 1000).toFixed(1)}s · ${meta.llm_calls} LLM call${meta.llm_calls === 1 ? "" : "s"} · $${meta.cost_usd.toFixed(4)}`
                  : "complete"}
              {handshakeReason && (
                <span style={{ marginLeft: 8 }}>· {handshakeReason}</span>
              )}
            </div>
          </div>
          <button
            type="button"
            className="result-panel__close"
            onClick={onClose}
          >
            Close
          </button>
        </header>

        <div className="result-panel__body">
          {/* Punch line first */}
          {(synth || loom) && (
            <section className="result-panel__section">
              <div className="result-panel__section-label">
                {synth ? "Consensus" : "Direct answer"}
              </div>
              <div className="result-panel__consensus">
                {synth ? synth.consensus_summary : loom || "—"}
                {synth && synth.dissenters.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    {synth.dissenters.map((d) => {
                      const p = getPersona(d.sme_id);
                      return (
                        <div
                          key={d.sme_id}
                          style={{
                            fontSize: 11.5,
                            marginTop: 4,
                            color: "var(--text-muted)",
                          }}
                        >
                          <span
                            style={{
                              padding: "2px 6px",
                              borderRadius: 4,
                              background: p?.color.bg ?? "var(--bg-soft)",
                              color: p?.color.fg ?? "var(--text-muted)",
                              fontWeight: 500,
                              marginRight: 6,
                            }}
                          >
                            {p?.name ?? d.sme_id}
                          </span>
                          dissents — {d.reason}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Per-SME accordion */}
          {smesList.length > 0 && (
            <section className="result-panel__section">
              <div className="result-panel__section-label">
                Expert views ({smesList.length})
              </div>
              {smesList.map((s) => {
                const p = getPersona(s.sme_id);
                const open = expanded.has(s.sme_id);
                return (
                  <div key={s.sme_id} className="result-panel__sme">
                    <button
                      type="button"
                      className="result-panel__sme-head"
                      onClick={() => toggle(s.sme_id)}
                      aria-expanded={open}
                    >
                      <span
                        aria-hidden
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 6,
                          background: p?.color.bg ?? "var(--bg-soft)",
                          color: p?.color.fg ?? "var(--text-muted)",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {p && <SMEIcon name={p.icon} size={12} />}
                      </span>
                      <span className="result-panel__sme-name" style={{ color: p?.color.fg }}>
                        {p?.name ?? s.sme_id}
                      </span>
                      <span className="result-panel__sme-status">
                        {s.done ? "answered" : busy ? "writing…" : "stopped"}
                      </span>
                      <span aria-hidden style={{ marginLeft: 6, color: "var(--text-faint)" }}>
                        {open ? "▾" : "▸"}
                      </span>
                    </button>
                    {open && (
                      <div className="result-panel__sme-body markdown-doc">
                        {s.text ? (
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{ img: () => null }}
                          >
                            {s.text}
                          </ReactMarkdown>
                        ) : (
                          <span
                            style={{
                              color: "var(--text-faint)",
                              fontStyle: "italic",
                            }}
                          >
                            …
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          )}

          {/* Loom wrap-up (only when there's also a synth — otherwise loom is the consensus card above) */}
          {synth && loom && (
            <section className="result-panel__section">
              <div className="result-panel__section-label">Loom wraps up</div>
              <div className="result-panel__loom">
                <span aria-hidden className="result-panel__loom-mark" />
                <div style={{ flex: 1 }} className="markdown-doc">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{ img: () => null }}
                  >
                    {loom}
                  </ReactMarkdown>
                </div>
              </div>
            </section>
          )}

          {error && (
            <div style={{ color: "#dc2626", fontSize: 12, marginTop: 8 }}>
              {error}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
