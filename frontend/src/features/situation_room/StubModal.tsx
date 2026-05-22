/**
 * Small "coming in Phase 2" modal. Used when the user clicks a station card
 * or the pinned-incident "Join briefing →" link. Better than a no-op — gives
 * a clear signal that the surface is scoped and what to do today.
 */
import { useEffect } from "react";

type Props = {
  title: string;
  onClose: () => void;
};

export function StubModal({ title, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="stub-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35"
      onClick={onClose}
    >
      <div
        className="max-w-md w-[92%] rounded-xl bg-[var(--color-background-primary)] p-6 shadow-[0_24px_60px_rgba(20,21,42,0.20)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="stub-modal-title"
          className="text-[15px] font-medium text-[var(--text)] leading-tight"
        >
          {title}
        </h2>
        <p className="mt-3 text-[13px] leading-relaxed text-[var(--text-muted)]">
          Standing Meeting view — Phase 2. Shipping soon. For now, use the
          command bar at the bottom to ask any SME directly through the
          existing chat.
        </p>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="text-[13px] font-medium px-4 py-1.5 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] hover:opacity-80 transition"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
