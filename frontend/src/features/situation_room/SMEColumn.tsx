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
    const prefix =
      `You are ${persona.name}, the ${persona.role} SME. Your domains: ` +
      `${persona.domain.join(", ")}. ` +
      `Respond from this expertise only. Keep it to 3-5 sentences. ` +
      `If your view disagrees with the obvious answer, say so explicitly. ` +
      `End with a one-line recommendation prefixed with "Recommend:".\n\n` +
      `Question: `;

    (async () => {
      try {
        let any = false;
        for await (const ev of streamChat(
          [{ role: "user", content: prefix + question }],
          ctrl.signal,
          slug,
        )) {
          if (ev.type === "delta") {
            if (!any) {
              setStatus("answering");
              any = true;
            }
            setText((t) => t + ev.text);
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
            Reading the catalog…
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
