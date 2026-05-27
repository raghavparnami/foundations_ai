/**
 * Slim, Claude-Code-clean input. Pinned at the bottom of the content area.
 *
 * Features:
 *  - Enter to send, Shift+Enter for newline, Esc to stop streaming, ⌘K to focus
 *  - @-mention autocomplete: type `@` then any prefix of an SME id/name → a
 *    floating picker shows matching personas with name + role + domain
 *    keywords; ↑/↓ to navigate, Enter or Tab to insert, Esc to dismiss
 *  - Live spend-this-turn pill on the right
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { SMEIcon } from "../situation_room/icons";
import { useAllPersonas } from "../situation_room/useCustomPersonas";
import type { SMEPersona } from "../situation_room/types";

type Props = {
  busy: boolean;
  onSubmit: (text: string) => void;
  onStop?: () => void;
  liveCostUsd?: number;
};

export default function ComposerBar({ busy, onSubmit, onStop, liveCostUsd }: Props) {
  const [value, setValue] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerIdx, setPickerIdx] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const { personas } = useAllPersonas();

  const matches = useMemo(() => {
    if (!pickerOpen) return [];
    const q = pickerQuery.toLowerCase().trim();
    const all = personas;
    if (!q) return all.slice(0, 6);
    return all
      .filter(
        (p) =>
          p.id.toLowerCase().startsWith(q) ||
          p.name.toLowerCase().startsWith(q),
      )
      .slice(0, 6);
  }, [pickerOpen, pickerQuery, personas]);

  // Global hotkeys: ⌘K focus, Esc stop when streaming.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current?.focus();
      }
      if (busy && e.key === "Escape" && !pickerOpen) {
        e.preventDefault();
        onStop?.();
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [busy, onStop, pickerOpen]);

  function fire() {
    const t = value.trim();
    if (!t) return;
    setValue("");
    onSubmit(t);
  }

  // Detect @-mention as the user types or moves the caret.
  function updatePickerFromCaret(text: string, caret: number) {
    // Walk back to find a @<word> at the caret position.
    let i = caret - 1;
    while (i >= 0) {
      const ch = text[i] ?? "";
      if (ch === "@") {
        // Ensure preceded by start-of-input or whitespace.
        const before = i > 0 ? text[i - 1] : "";
        if (i === 0 || /\s/.test(before ?? "")) {
          const after = text.slice(i + 1, caret);
          // Only allow word chars in the prefix.
          if (/^[\w-]*$/.test(after)) {
            setPickerOpen(true);
            setPickerQuery(after);
            setPickerIdx(0);
            return;
          }
        }
        break;
      }
      if (/\s/.test(ch)) break;
      i--;
    }
    setPickerOpen(false);
  }

  function insertMention(persona: SMEPersona) {
    const el = ref.current;
    const caret = el?.selectionStart ?? value.length;
    // Find the position of '@' that triggered the picker.
    let i = caret - 1;
    while (i >= 0 && (value[i] ?? "") !== "@") i--;
    if (i < 0) return;
    const before = value.slice(0, i);
    const after = value.slice(caret);
    const insertion = `@${persona.name} `;
    const next = before + insertion + after;
    setValue(next);
    setPickerOpen(false);
    // Restore caret right after the insertion.
    requestAnimationFrame(() => {
      const pos = before.length + insertion.length;
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  }

  return (
    <div className="px-6 pb-5 pt-2 relative">
      {pickerOpen && matches.length > 0 && (
        <MentionPicker
          matches={matches}
          activeIdx={pickerIdx}
          onPick={insertMention}
        />
      )}
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
          onChange={(e) => {
            const v = e.target.value;
            setValue(v);
            updatePickerFromCaret(v, e.target.selectionStart ?? v.length);
          }}
          onKeyUp={(e) => {
            // Caret movement (arrows / clicks) can also enter/exit a mention.
            const el = e.currentTarget;
            updatePickerFromCaret(el.value, el.selectionStart ?? el.value.length);
          }}
          onClick={(e) => {
            const el = e.currentTarget;
            updatePickerFromCaret(el.value, el.selectionStart ?? el.value.length);
          }}
          onKeyDown={(e) => {
            if (pickerOpen && matches.length > 0) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setPickerIdx((i) => Math.min(matches.length - 1, i + 1));
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setPickerIdx((i) => Math.max(0, i - 1));
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                const sel = matches[pickerIdx];
                if (sel) insertMention(sel);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setPickerOpen(false);
                return;
              }
            }
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
              : "Ask Loom. Type @ to pick one SME directly."
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
        Enter to send · Shift+Enter for newline · @ to pick one SME · ⌘K to focus
      </div>
    </div>
  );
}

function MentionPicker({
  matches,
  activeIdx,
  onPick,
}: {
  matches: SMEPersona[];
  activeIdx: number;
  onPick: (p: SMEPersona) => void;
}) {
  return (
    <div
      role="listbox"
      aria-label="Mention an SME"
      className="absolute left-1/2 -translate-x-1/2 bottom-[calc(100%-1.25rem)] w-[92%] max-w-[560px] z-30"
      style={{ marginBottom: 6 }}
    >
      <div
        className="rounded-xl overflow-hidden shadow-[0_12px_36px_rgba(20,21,42,0.18)]"
        style={{
          background: "var(--color-background-primary)",
          border: "0.5px solid var(--color-border-tertiary)",
        }}
      >
        <div className="px-3 py-1.5 text-[10.5px] uppercase tracking-wider font-medium text-[var(--text-faint)]">
          Mention an SME
        </div>
        <ul>
          {matches.map((p, i) => {
            const active = i === activeIdx;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onPick(p);
                  }}
                  className="w-full text-left flex items-center gap-3 px-3 py-2 transition"
                  style={{
                    background: active ? p.color.bg : "transparent",
                    color: active ? p.color.fg : "var(--text)",
                  }}
                >
                  <span
                    aria-hidden
                    className="inline-flex items-center justify-center rounded-full shrink-0"
                    style={{
                      width: 26,
                      height: 26,
                      background: p.color.bg,
                      color: p.color.fg,
                    }}
                  >
                    <SMEIcon name={p.icon} size={13} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-medium leading-tight">
                      {p.name}
                      <span className="text-[10.5px] text-[var(--text-faint)] font-normal ml-1.5">
                        · {p.role}
                      </span>
                    </div>
                    {p.domain.length > 0 && (
                      <div className="text-[10.5px] text-[var(--text-muted)] truncate mt-0.5">
                        {p.domain.slice(0, 5).join(" · ")}
                      </div>
                    )}
                  </div>
                  <kbd
                    aria-hidden
                    className="hidden sm:inline-flex text-[9.5px] text-[var(--text-faint)] font-mono"
                  >
                    @{p.id}
                  </kbd>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="px-3 py-1.5 text-[10px] text-[var(--text-faint)] flex items-center justify-between"
             style={{ borderTop: "0.5px solid var(--color-border-tertiary)" }}>
          <span>↑↓ navigate · Enter insert · Esc dismiss</span>
        </div>
      </div>
    </div>
  );
}
