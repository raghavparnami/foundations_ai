/**
 * Thin command bar pinned to the bottom of the Situation Room content area.
 *
 * Submitting hands the text to the existing chat pipeline via `onSubmit`.
 * Cmd/Ctrl+K focuses the input. `@convene` syntax is plain text in Phase 1
 * (the Phase-2 parser will route it to the Standing Meeting view).
 */
import { useEffect, useRef, useState } from "react";
import { CommandIcon } from "./icons";

type Props = {
  onSubmit: (text: string) => void;
};

export default function CommandBar({ onSubmit }: Props) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    setValue("");
    onSubmit(trimmed);
  }

  return (
    <form
      onSubmit={submit}
      className="flex items-center gap-3 rounded-md bg-[var(--color-background-primary)] px-3.5 h-10"
      style={{ border: "0.5px solid var(--color-border-tertiary)" }}
    >
      <label htmlFor="situation-command-bar" className="sr-only">
        Ask any SME or convene a meeting
      </label>
      <span
        aria-hidden
        className="text-[var(--text-faint)] shrink-0 inline-flex items-center"
      >
        <CommandIcon size={14} />
      </span>
      <input
        ref={ref}
        id="situation-command-bar"
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoComplete="off"
        placeholder="Ask the panel, or @Marcus / @IRIS / @Quinn… to pick one"
        className="flex-1 bg-transparent text-[13px] text-[var(--text)] placeholder:text-[var(--text-faint)] outline-none"
      />
      <kbd
        aria-hidden
        className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-medium tracking-wide text-[var(--text-faint)] bg-[var(--bg-soft)]"
        style={{ border: "0.5px solid var(--color-border-tertiary)" }}
      >
        ⌘K
      </kbd>
    </form>
  );
}
