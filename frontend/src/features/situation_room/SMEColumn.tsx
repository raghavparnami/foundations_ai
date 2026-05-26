/**
 * One SME's deliberation column inside a Standing Meeting.
 *
 * On mount, opens a streaming chat with a persona-prefixed user message
 * and renders the assistant's text incrementally. The column has its own
 * conversation_id (`sm-<persona>-<ts>`) so it doesn't pollute the user's
 * regular chat history; HistoryList can filter out `sm-…` slugs.
 *
 * Phase 2 v1: no disagreement detection — every column is just a streaming
 * answer. The visual mechanism for the "disagreeing" border is wired but
 * driven by a placeholder flag that defaults to false.
 */
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { streamDeliberate } from "./streamDeliberate";
import { sendFeedback } from "./ledger";
import { SMEIcon } from "./icons";
import type { SMEPersona } from "./types";

type Status = "thinking" | "answering" | "done" | "error";

type Props = {
  persona: SMEPersona;
  question: string;
  /** Live finding from /api/situation-room/snapshot. Injected as context so
   *  the model doesn't need to walk the catalog itself — single LLM call,
   *  no tool loop. */
  contextFinding?: string | null;
  /** The SQL probe behind contextFinding — shown as a clickable receipt. */
  evidenceSql?: string | null;
  evidenceRow?: Record<string, unknown> | null;
  disagreeing?: boolean;
  /** Reason text shown when this column dissents from the panel majority. */
  dissentReason?: string | null;
  /** Notified when the column reaches a terminal state (done / error) so the
   *  parent can run synthesis after all columns are settled. */
  onComplete?: (smeId: string, finalText: string, ok: boolean) => void;
  /** Decision slug for this meeting · enables thumbs feedback once present. */
  decisionSlug?: string | null;
};

export default function SMEColumn({
  persona,
  question,
  contextFinding,
  evidenceSql,
  evidenceRow,
  disagreeing,
  dissentReason,
  onComplete,
  decisionSlug,
}: Props) {
  const [showEvidence, setShowEvidence] = useState(false);
  const [rating, setRating] = useState<1 | -1 | 0>(0);

  async function submitRating(r: 1 | -1) {
    if (!decisionSlug) return;
    setRating(r);
    try {
      await sendFeedback(persona.id, decisionSlug, r);
    } catch {
      // best-effort
    }
  }
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>("thinking");
  const [error, setError] = useState<string | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // As new text arrives, keep the column body scrolled to the bottom so the
  // user always sees the freshest sentence without scrolling manually.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [text]);

  useEffect(() => {
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    const prefix = buildPersonaPrefix(persona);

    (async () => {
      let buffer = "";
      try {
        for await (const ev of streamDeliberate(
          {
            sme_id: persona.id,
            question,
            persona_prompt: prefix,
            context_finding: contextFinding ?? null,
          },
          ctrl.signal,
        )) {
          if (ev.type === "delta") {
            buffer += ev.text;
            setStatus("answering");
            setText(buffer);
          } else if (ev.type === "done") {
            setStatus("done");
            onComplete?.(persona.id, buffer, true);
          } else if (ev.type === "error") {
            setStatus("error");
            setError(ev.message);
            onComplete?.(persona.id, buffer, false);
          }
        }
      } catch (e) {
        if (!ctrl.signal.aborted) {
          setStatus("error");
          setError((e as Error).message);
          onComplete?.(persona.id, buffer, false);
        }
      }
    })();

    return () => ctrl.abort();
  }, [persona.id, persona.name, persona.role, persona.domain, question]);

  const isDissenting = Boolean(disagreeing && dissentReason);
  const borderColor = isDissenting ? persona.color.fg : "var(--color-border-tertiary)";
  const borderWidth = isDissenting ? "1.5px" : "0.5px";
  const accent = persona.color.fg;

  return (
    <article
      aria-label={`${persona.name} deliberating`}
      className="rounded-md bg-[var(--color-background-primary)] p-4 flex flex-col"
      style={{ border: `${borderWidth} solid ${borderColor}`, height: 540 }}
    >
      <header className="flex items-center gap-3">
        <span
          aria-hidden
          className="inline-flex items-center justify-center rounded-full shrink-0"
          style={{
            width: 32,
            height: 32,
            background: persona.color.bg,
            color: persona.color.fg,
          }}
        >
          <SMEIcon name={persona.icon} size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-[var(--text)] leading-tight">
            {persona.name}
          </div>
          <div className="text-[11px] text-[var(--text-muted)] leading-tight mt-0.5">
            {persona.role}
          </div>
        </div>
        <StatusBadge status={status} accent={accent} />
      </header>

      {isDissenting && (
        <div
          role="note"
          className="mt-2 rounded text-[11px] leading-snug px-2 py-1.5"
          style={{
            background: persona.color.bg,
            color: persona.color.fg,
            border: `0.5px solid ${persona.color.fg}55`,
          }}
        >
          <span className="font-medium uppercase tracking-wider text-[9.5px]">Dissenting · </span>
          {dissentReason}
        </div>
      )}

      <div
        ref={bodyRef}
        className="mt-3 text-[12.5px] leading-relaxed text-[var(--text)] markdown-doc flex-1 min-h-0 overflow-y-auto pr-1"
      >
        {status === "thinking" && (
          <div className="text-[var(--text-faint)] italic flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ background: accent }}
            />
            Drafting view…
          </div>
        )}
        {status === "error" && (
          <p className="text-[12px] text-red-600">{error ?? "failed"}</p>
        )}
        {text && (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{ img: () => null }}
          >
            {text}
          </ReactMarkdown>
        )}
      </div>

      {status === "done" && decisionSlug && (
        <div className="mt-2 shrink-0 flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider font-medium text-[var(--text-faint)] mr-1">
            Useful?
          </span>
          <button
            type="button"
            onClick={() => void submitRating(1)}
            aria-pressed={rating === 1}
            aria-label="Mark this answer useful"
            className="w-6 h-6 inline-flex items-center justify-center rounded-md transition"
            style={{
              background: rating === 1 ? "#E1F5EE" : "var(--bg-soft)",
              color: rating === 1 ? "#0F6E56" : "var(--text-muted)",
              border: "0.5px solid var(--color-border-tertiary)",
            }}
          >
            👍
          </button>
          <button
            type="button"
            onClick={() => void submitRating(-1)}
            aria-pressed={rating === -1}
            aria-label="Mark this answer not useful"
            className="w-6 h-6 inline-flex items-center justify-center rounded-md transition"
            style={{
              background: rating === -1 ? "#FBE5E1" : "var(--bg-soft)",
              color: rating === -1 ? "#B33A21" : "var(--text-muted)",
              border: "0.5px solid var(--color-border-tertiary)",
            }}
          >
            👎
          </button>
          {rating !== 0 && (
            <span className="text-[10.5px] text-[var(--text-faint)] ml-1">
              recorded
            </span>
          )}
        </div>
      )}

      {evidenceSql && (
        <div className="mt-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowEvidence((v) => !v)}
            className="text-[10.5px] uppercase tracking-wider font-medium text-[var(--text-faint)] hover:text-[var(--text)] transition flex items-center gap-1"
          >
            <span aria-hidden>{showEvidence ? "▾" : "▸"}</span>
            Evidence
          </button>
          {showEvidence && (
            <div
              className="mt-1.5 rounded text-[11px] font-mono p-2 overflow-x-auto"
              style={{
                background: "var(--bg-soft)",
                border: "0.5px solid var(--color-border-tertiary)",
                color: "var(--text-muted)",
                maxHeight: 140,
              }}
            >
              <div className="whitespace-pre-wrap break-words">
                {evidenceSql}
              </div>
              {evidenceRow && (
                <div
                  className="mt-1.5 pt-1.5 text-[var(--text)]"
                  style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}
                >
                  → {JSON.stringify(evidenceRow)}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function StatusBadge({ status, accent }: { status: Status; accent: string }) {
  const label =
    status === "thinking"
      ? "Thinking"
      : status === "answering"
        ? "Answering"
        : status === "done"
          ? "Answered"
          : "Error";
  const dotColor =
    status === "thinking"
      ? "#B4B2A9"
      : status === "answering"
        ? accent
        : status === "done"
          ? "#1D9E75"
          : "#D85A30";
  return (
    <span className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider font-medium text-[var(--text-muted)]">
      <span
        aria-hidden
        className={
          "inline-block w-1.5 h-1.5 rounded-full" +
          (status === "answering" ? " animate-pulse" : "")
        }
        style={{ background: dotColor }}
      />
      {label}
    </span>
  );
}

/**
 * Per-SME prompt prefix. Each persona gets a distinct ANGLE so the
 * post-tool answers actually diverge — not just the name in the header.
 * Keep each prefix terse; the underlying chat agent already has its own
 * system prompt and will follow the tool flow regardless.
 */
function buildPersonaPrefix(persona: SMEPersona): string {
  const ANGLES: Record<string, string> = {
    marcus:
      "You are MARCUS, the Manufacturing Engineer. ANGLE: throughput and OEE. " +
      "Frame the answer in cycle-time impact, line-balance, and changeover variance. " +
      "Recommend equipment, scheduling, or staffing actions — not process-control or sensor actions.",
    iris:
      "You are IRIS, the IIoT / Sensors SME. ANGLE: raw telemetry. " +
      "Frame the answer in σ from baseline, sensor noise, sampling rate, anomaly clustering. " +
      "Recommend instrumentation, threshold, or data-quality actions — not maintenance or scheduling actions.",
    quinn:
      "You are QUINN, the Quality / SPC SME. ANGLE: process capability. " +
      "Frame the answer in Cpk, control limits, defect rate, and tolerance drift. " +
      "Recommend SPC, inspection, or supplier-quality actions — not equipment service or sensor actions.",
    sasha:
      "You are SASHA, the Supply Chain SME. ANGLE: material flow and buffer coverage. " +
      "If the catalog has no supply-chain data, say so plainly in one sentence and stop.",
    mason:
      "You are MASON, the Maintenance SME. ANGLE: equipment health and MTBF. " +
      "Frame the answer in failure modes, MTBF curve, time-to-service, work-order priority. " +
      "Recommend service intervals, parts, or PM-frequency changes — not SPC or scheduling.",
    sage:
      "You are SAGE, the Safety / Compliance SME. ANGLE: regulatory and audit. " +
      "Frame the answer in audit checkpoints, escalation thresholds, regulatory exposure. " +
      "Recommend audit, escalation, or veto actions — not operational fixes.",
  };
  const angle =
    ANGLES[persona.id] ??
    `You are ${persona.name}, the ${persona.role} SME. Domain: ${persona.domain.join(", ")}.`;
  return (
    angle +
    "\n\nFORMAT (strict):\n" +
    "After you've gathered data from the catalog, write your FINAL ANSWER:\n" +
    "- 3 to 5 sentences of analysis from YOUR angle, quoting actual numbers you saw\n" +
    "- One sentence stating your disagreement with the obvious view (if any)\n" +
    "- Last line, on its own, prefixed exactly: 'Recommend: …'\n\n" +
    "Do NOT narrate tool calls. Do NOT write 'Let me check…' or 'Now let me search…'. " +
    "Do NOT restate the question. Just the analysis."
  );
}
