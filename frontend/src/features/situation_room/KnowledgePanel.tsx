/**
 * Modal for managing a single SME's institutional knowledge.
 *
 * Users add free-text notes ("On LINE-B, always check changeover ladder
 * before blaming maintenance.") that get injected verbatim into that
 * SME's deliberation prompt next time a meeting opens.
 *
 * Backend:
 *   GET    /api/sme/{sme_id}/knowledge      → list
 *   POST   /api/sme/{sme_id}/knowledge      → add
 *   PATCH  /api/sme/knowledge/{id}          → toggle / edit
 *   DELETE /api/sme/knowledge/{id}          → remove
 */
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { SMEIcon } from "./icons";
import type { SMEPersona } from "./types";

type Knowledge = {
  id: number;
  sme_id: string;
  text: string;
  importance: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

type Props = {
  persona: SMEPersona;
  onClose: () => void;
  /** Notified when the active note count for this SME changes. Lets the
   *  card show a small badge with the count. */
  onChange?: (count: number) => void;
};

export default function KnowledgePanel({ persona, onClose, onChange }: Props) {
  const [notes, setNotes] = useState<Knowledge[]>([]);
  const [draft, setDraft] = useState("");
  const [importance, setImportance] = useState(3);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const list = await api.get<Knowledge[]>(
        `/api/sme/${persona.id}/knowledge`,
      );
      setNotes(list);
      onChange?.(list.filter((n) => n.enabled).length);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persona.id]);

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function addNote() {
    const text = draft.trim();
    if (text.length < 2) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post<Knowledge>(`/api/sme/${persona.id}/knowledge`, {
        text,
        importance,
      });
      setDraft("");
      setImportance(3);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleEnabled(n: Knowledge) {
    try {
      await fetch(`/api/sme/knowledge/${n.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !n.enabled }),
      });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function removeNote(n: Knowledge) {
    if (!confirm(`Delete this note from ${persona.name}?`)) return;
    try {
      await api.delete(`/api/sme/knowledge/${n.id}`);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="knowledge-title"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[92%] max-w-2xl rounded-2xl bg-[var(--color-background-primary)] p-6 shadow-[0_24px_60px_rgba(0,0,0,0.35)] flex flex-col gap-4 max-h-[85vh]"
        style={{ border: "0.5px solid var(--color-border-tertiary)" }}
      >
        <header className="flex items-center gap-3">
          <span
            aria-hidden
            className="inline-flex items-center justify-center rounded-full shrink-0"
            style={{
              width: 36,
              height: 36,
              background: persona.color.bg,
              color: persona.color.fg,
            }}
          >
            <SMEIcon name={persona.icon} size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id="knowledge-title"
              className="text-[15px] font-medium text-[var(--text)] leading-tight"
            >
              Teach {persona.name}
            </h2>
            <p className="text-[11.5px] text-[var(--text-muted)] mt-0.5">
              Your notes are injected into {persona.name}'s deliberation prompt next time a meeting opens.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[12px] font-medium px-3 py-1.5 rounded-full bg-[var(--bg-soft)] text-[var(--text-muted)] hover:text-[var(--text)] transition"
          >
            Close
          </button>
        </header>

        {/* Add new */}
        <div
          className="rounded-md p-3 flex flex-col gap-2"
          style={{
            background: "var(--bg-soft)",
            border: "0.5px solid var(--color-border-tertiary)",
          }}
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Tell ${persona.name} something they should remember…`}
            rows={3}
            maxLength={500}
            className="w-full bg-transparent outline-none text-[13px] text-[var(--text)] placeholder:text-[var(--text-faint)] resize-none"
          />
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
              Importance
              <select
                value={importance}
                onChange={(e) => setImportance(Number(e.target.value))}
                className="bg-transparent border-0 text-[11.5px] text-[var(--text)] outline-none cursor-pointer"
              >
                <option value={1}>1 · low</option>
                <option value={2}>2</option>
                <option value={3}>3 · default</option>
                <option value={4}>4</option>
                <option value={5}>5 · critical</option>
              </select>
            </label>
            <div className="flex items-center gap-2">
              <span className="text-[10.5px] text-[var(--text-faint)]">
                {draft.length}/500
              </span>
              <button
                type="button"
                onClick={() => void addNote()}
                disabled={submitting || draft.trim().length < 2}
                className="text-[12px] font-medium px-3 py-1.5 rounded-full text-white disabled:opacity-40 transition"
                style={{ background: persona.color.fg }}
              >
                {submitting ? "Saving…" : "Add note"}
              </button>
            </div>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading && (
            <div className="text-[11.5px] text-[var(--text-faint)] italic">
              loading…
            </div>
          )}
          {error && (
            <div className="text-[11.5px] text-red-500">{error}</div>
          )}
          {!loading && notes.length === 0 && !error && (
            <div className="text-[12px] text-[var(--text-faint)] italic">
              No notes yet. Add one above and {persona.name} will carry it into every future meeting.
            </div>
          )}
          <ul className="space-y-2">
            {notes.map((n) => (
              <li
                key={n.id}
                className="rounded-md p-3 flex items-start gap-3"
                style={{
                  background: "var(--bg-soft)",
                  border: "0.5px solid var(--color-border-tertiary)",
                  opacity: n.enabled ? 1 : 0.5,
                }}
              >
                <span
                  aria-hidden
                  title={`Importance ${n.importance}`}
                  className="shrink-0 mt-0.5 inline-flex items-center justify-center rounded text-[10px] font-medium w-5 h-5"
                  style={{
                    background: persona.color.bg,
                    color: persona.color.fg,
                  }}
                >
                  {n.importance}
                </span>
                <div className="flex-1 min-w-0 text-[12.5px] text-[var(--text)]">
                  {n.text}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => void toggleEnabled(n)}
                    title={n.enabled ? "Disable" : "Enable"}
                    className="text-[10.5px] uppercase tracking-wider font-medium px-2 py-1 rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-elev)]"
                  >
                    {n.enabled ? "On" : "Off"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeNote(n)}
                    title="Delete"
                    className="text-[10.5px] font-medium px-2 py-1 rounded-md text-red-500 hover:bg-[var(--bg-elev)]"
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
