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
import { streamChat } from "../../lib/chat";
import { SMEIcon } from "./icons";
import type { SMEPersona } from "./types";

type Status = "thinking" | "answering" | "done" | "error";

type Props = {
  persona: SMEPersona;
  question: string;
  disagreeing?: boolean;
};

export default function SMEColumn({ persona, question, disagreeing }: Props) {
  const [text, setText] = useState("");
  const [toolCount, setToolCount] = useState(0);
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
    const slug = `sm-${persona.id}-${Date.now().toString(36)}`;
    const prefix = buildPersonaPrefix(persona);

    (async () => {
      try {
        // The chat agent narrates its tool calls ("Let me check the wiki…")
        // as `delta` events BEFORE the answer. Every SME's narration looks
        // identical, which makes columns appear duplicated.
        //
        // Filter: only show deltas that arrive AFTER the most recent
        // tool_output. Every tool_start clears the buffer so any narration
        // that snuck in between rounds is dropped. If the stream never
        // calls a tool, all deltas are shown (no narration to hide).
        let inFlight = 0;
        let toolsEverStarted = false;
        for await (const ev of streamChat(
          [{ role: "user", content: prefix + "\n\nQuestion: " + question }],
          ctrl.signal,
          slug,
        )) {
          if (ev.type === "tool_start") {
            inFlight += 1;
            toolsEverStarted = true;
            setText("");
            setToolCount((n) => n + 1);
          } else if (ev.type === "tool_output") {
            inFlight = Math.max(0, inFlight - 1);
          } else if (ev.type === "delta") {
            // Show the delta if: no tools have fired yet (whole stream is
            // the answer), OR all started tools have completed (we're in
            // the post-tool answer phase).
            const showable = !toolsEverStarted || inFlight === 0;
            if (showable) {
              setStatus("answering");
              setText((t) => t + ev.text);
            }
          } else if (ev.type === "done") {
            setStatus("done");
          } else if (ev.type === "error") {
            setStatus("error");
            setError(ev.message);
          }
        }
      } catch (e) {
        if (!ctrl.signal.aborted) {
          setStatus("error");
          setError((e as Error).message);
        }
      }
    })();

    return () => ctrl.abort();
  }, [persona.id, persona.name, persona.role, persona.domain, question]);

  const borderColor = disagreeing ? persona.color.fg : "var(--color-border-tertiary)";
  const accent = persona.color.fg;

  return (
    <article
      aria-label={`${persona.name} deliberating`}
      className="rounded-md bg-[var(--color-background-primary)] p-4 flex flex-col"
      style={{ border: `0.5px solid ${borderColor}`, height: 460 }}
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
            {toolCount === 0
              ? "Consulting catalog…"
              : `Consulting catalog · ${toolCount} source${toolCount === 1 ? "" : "s"}…`}
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
