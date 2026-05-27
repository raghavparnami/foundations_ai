/**
 * Slim, Claude-Code-clean input. Pinned at the bottom of the content area.
 * On focus, the bar lifts slightly; the bottom-right shows a status pill
 * (idle / streaming / spend-this-turn).
 */
import { useEffect, useRef, useState } from "react";

type Props = {
  busy: boolean;
  onSubmit: (text: string) => void;
  onStop?: () => void;
  liveCostUsd?: number;
};

export default function ComposerBar({ busy, onSubmit, onStop, liveCostUsd }: Props) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current?.focus();
      }
      if (busy && e.key === "Escape") {
        e.preventDefault();
        onStop?.();
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [busy, onStop]);

  function fire() {
    const t = value.trim();
    if (!t) return;
    setValue("");
    onSubmit(t);
  }

  return (
    <div className="px-6 pb-5 pt-2">
      <div
        className="max-w-[840px] mx-auto rounded-xl flex items-end gap-2 px-3 py-2.5 transition focus-within:shadow-[0_2px_18px_rgba(91,108,255,0.10)]"
        style={{
          background: "var(--color-background-primary)",
          border: "0.5px solid var(--color-border-tertiary)",
        }}
      >
        <span aria-hidden className="text-[var(--text-faint)] mt-1 shrink-0">
          ›
        </span>
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              fire();
            }
          }}
          rows={1}
          autoFocus
          placeholder={
            busy
              ? "Type to redirect…"
              : "Ask Loom. Try @Marcus or @IRIS for one expert, or just describe what you want to know."
          }
          className="flex-1 min-h-[24px] max-h-32 bg-transparent text-[14px] text-[var(--text)] placeholder:text-[var(--text-faint)] outline-none resize-none leading-snug"
        />
        <div className="flex items-center gap-2 shrink-0 pb-0.5">
          {typeof liveCostUsd === "number" && liveCostUsd > 0 && (
            <span className="text-[10.5px] text-[var(--text-faint)] font-mono">
              ${liveCostUsd.toFixed(4)}
            </span>
          )}
          {busy ? (
            <button
              type="button"
              onClick={onStop}
              className="text-[12px] font-medium px-3 py-1 rounded-full bg-[var(--bg-soft)] text-[var(--text-muted)] hover:text-[var(--text)] transition"
              title="Stop (Esc)"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={fire}
              disabled={!value.trim()}
              className="text-[12px] font-medium px-3.5 py-1 rounded-full text-white disabled:opacity-40 transition"
              style={{ background: "var(--gradient-hero)" }}
            >
              Send
            </button>
          )}
        </div>
      </div>
      <div className="text-[10px] text-[var(--text-faint)] text-center mt-1.5">
        Enter to send · Shift+Enter for newline · ⌘K to focus
      </div>
    </div>
  );
}
