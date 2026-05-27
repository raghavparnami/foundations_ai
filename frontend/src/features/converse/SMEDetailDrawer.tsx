/**
 * Right-side drawer that opens when the user clicks an SME chip in the
 * rail (or anywhere else). One stop for:
 *   - Persona header (avatar, name, role, domain keywords)
 *   - Spend this shift
 *   - Calibration (% useful · cases)
 *   - Recent activity (meetings / ratings / notes taught / distilled)
 *   - Knowledge editor (add / toggle / delete notes)
 *   - 'Distill recent meetings' action
 *   - 'Delete SME' for user-created personas
 */
import { useEffect, useState } from "react";
import { api, ApiError } from "../../lib/api";
import { SMEIcon } from "../situation_room/icons";
import ActivityDrawer from "../situation_room/ActivityDrawer";
import { SME_ROSTER } from "../situation_room/fixtures";
import type { SMEPersona } from "../situation_room/types";

type Knowledge = {
  id: number;
  sme_id: string;
  text: string;
  importance: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

type Calibration = {
  total: number;
  up: number;
  down: number;
  accuracy: number | null;
};

type Spend = {
  calls: number;
  tokens: number;
  cost_usd: number;
};

type Props = {
  persona: SMEPersona;
  spend?: Spend | null;
  calibration?: Calibration | null;
  onClose: () => void;
  onDeleted?: () => void;
};

export default function SMEDetailDrawer({
  persona,
  spend,
  calibration,
  onClose,
  onDeleted,
}: Props) {
  const [notes, setNotes] = useState<Knowledge[]>([]);
  const [draft, setDraft] = useState("");
  const [importance, setImportance] = useState(3);
  const [submitting, setSubmitting] = useState(false);
  const [distilling, setDistilling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isBuiltIn = SME_ROSTER.some((p) => p.id === persona.id);

  async function refresh() {
    try {
      const list = await api.get<Knowledge[]>(
        `/api/sme/${persona.id}/knowledge`,
      );
      setNotes(list);
    } catch (e) {
      if (!(e instanceof ApiError)) setError((e as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persona.id]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  async function addNote() {
    const text = draft.trim();
    if (text.length < 2) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/api/sme/${persona.id}/knowledge`, {
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

  async function toggle(n: Knowledge) {
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

  async function remove(n: Knowledge) {
    if (!confirm(`Delete this note from ${persona.name}?`)) return;
    try {
      await api.delete(`/api/sme/knowledge/${n.id}`);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function distill() {
    setDistilling(true);
    setError(null);
    try {
      const r = await api.post<{
        sampled_decisions: number;
        notes_added: number;
        notes: string[];
      }>("/api/sme/distill", { sme_id: persona.id, look_back_days: 14 });
      if (r.notes_added === 0) {
        setError(
          r.sampled_decisions < 2
            ? "Not enough past meetings to distill yet."
            : "Nothing new — recent meetings didn't form a pattern.",
        );
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDistilling(false);
    }
  }

  async function deletePersona() {
    if (
      !confirm(
        `Delete the SME "${persona.name}"? This also removes their knowledge notes.`,
      )
    )
      return;
    try {
      await api.delete(`/api/sme/personas/${persona.id}`);
      onDeleted?.();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex justify-end bg-black/30"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[440px] max-w-[92%] h-full bg-[var(--color-background-primary)] flex flex-col shadow-[0_0_36px_rgba(20,21,42,0.15)]"
        style={{ borderLeft: "0.5px solid var(--color-border-tertiary)" }}
      >
        {/* Header */}
        <div className="px-5 py-4 flex items-start gap-3 border-b border-[var(--color-border-tertiary)]">
          <span
            aria-hidden
            className="inline-flex items-center justify-center rounded-full shrink-0"
            style={{
              width: 40,
              height: 40,
              background: persona.color.bg,
              color: persona.color.fg,
            }}
          >
            <SMEIcon name={persona.icon} size={20} />
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="text-[15px] font-semibold text-[var(--text)] leading-tight">
              {persona.name}
            </h2>
            <div className="text-[11.5px] text-[var(--text-muted)] mt-0.5">
              {persona.role}
            </div>
            {persona.domain.length > 0 && (
              <div className="text-[10.5px] text-[var(--text-faint)] mt-1 truncate">
                {persona.domain.slice(0, 6).join(" · ")}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[12px] text-[var(--text-muted)] hover:text-[var(--text)] px-2 py-1"
          >
            Close
          </button>
        </div>

        {/* Quick stats */}
        <div className="px-5 py-3 grid grid-cols-3 gap-3 border-b border-[var(--color-border-tertiary)] text-center">
          <Stat
            label="Spend"
            value={
              spend
                ? spend.cost_usd > 0
                  ? `$${spend.cost_usd.toFixed(3)}`
                  : "$0.00"
                : "—"
            }
            sub={spend ? `${spend.calls} call${spend.calls === 1 ? "" : "s"}` : "this shift"}
            accent={persona.color.fg}
          />
          <Stat
            label="Useful"
            value={
              calibration && calibration.total >= 1 && calibration.accuracy !== null
                ? `${Math.round(calibration.accuracy * 100)}%`
                : "—"
            }
            sub={
              calibration && calibration.total >= 1
                ? `${calibration.total} rated`
                : "no ratings"
            }
            accent={persona.color.fg}
          />
          <Stat
            label="Notes"
            value={String(notes.filter((n) => n.enabled).length)}
            sub={`${notes.length} total`}
            accent={persona.color.fg}
          />
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* Teach editor */}
          <section className="px-5 py-4 border-b border-[var(--color-border-tertiary)]">
            <h3 className="text-[10.5px] uppercase tracking-wider font-medium text-[var(--text-muted)] mb-2">
              Teach {persona.name}
            </h3>
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
                className="w-full bg-transparent outline-none text-[12.5px] text-[var(--text)] placeholder:text-[var(--text-faint)] resize-none"
              />
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-1.5 text-[10.5px] text-[var(--text-muted)]">
                  Importance
                  <select
                    value={importance}
                    onChange={(e) => setImportance(Number(e.target.value))}
                    className="bg-transparent border-0 text-[11px] text-[var(--text)] outline-none cursor-pointer"
                  >
                    <option value={1}>1 · low</option>
                    <option value={2}>2</option>
                    <option value={3}>3 · default</option>
                    <option value={4}>4</option>
                    <option value={5}>5 · critical</option>
                  </select>
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-[var(--text-faint)]">
                    {draft.length}/500
                  </span>
                  <button
                    type="button"
                    onClick={() => void addNote()}
                    disabled={submitting || draft.trim().length < 2}
                    className="text-[11px] font-medium px-2.5 py-1 rounded-full text-white disabled:opacity-40 transition"
                    style={{ background: persona.color.fg }}
                  >
                    {submitting ? "Saving…" : "Add note"}
                  </button>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void distill()}
              disabled={distilling}
              className="mt-3 text-[11px] font-medium px-3 py-1.5 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] hover:opacity-80 disabled:opacity-40 transition"
              title="Distill recurring patterns from the last 14 days of meetings into auto-generated notes"
            >
              {distilling ? "Distilling…" : "Distill from recent meetings"}
            </button>
            {error && (
              <div className="mt-2 text-[11px] text-red-500">{error}</div>
            )}
          </section>

          {/* Existing notes */}
          <section className="px-5 py-4 border-b border-[var(--color-border-tertiary)]">
            <h3 className="text-[10.5px] uppercase tracking-wider font-medium text-[var(--text-muted)] mb-2">
              Knowledge ({notes.length})
            </h3>
            {notes.length === 0 ? (
              <div className="text-[11.5px] text-[var(--text-faint)] italic">
                No notes yet. Add one above.
              </div>
            ) : (
              <ul className="space-y-1.5">
                {notes.map((n) => (
                  <li
                    key={n.id}
                    className="rounded-md p-2.5 flex items-start gap-2"
                    style={{
                      background: "var(--bg-soft)",
                      border: "0.5px solid var(--color-border-tertiary)",
                      opacity: n.enabled ? 1 : 0.5,
                    }}
                  >
                    <span
                      aria-hidden
                      title={`Importance ${n.importance}`}
                      className="shrink-0 mt-0.5 inline-flex items-center justify-center rounded text-[9.5px] font-medium w-5 h-5"
                      style={{
                        background: persona.color.bg,
                        color: persona.color.fg,
                      }}
                    >
                      {n.importance}
                    </span>
                    <div className="flex-1 min-w-0 text-[12px] text-[var(--text)]">
                      {n.text}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => void toggle(n)}
                        title={n.enabled ? "Disable" : "Enable"}
                        className="text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded text-[var(--text-muted)] hover:bg-[var(--bg-elev)]"
                      >
                        {n.enabled ? "On" : "Off"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(n)}
                        title="Delete"
                        className="text-[10.5px] font-medium px-1.5 py-0.5 rounded text-red-500 hover:bg-[var(--bg-elev)]"
                      >
                        ×
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Activity feed */}
          <section className="px-5 py-4 border-b border-[var(--color-border-tertiary)]">
            <h3 className="text-[10.5px] uppercase tracking-wider font-medium text-[var(--text-muted)] mb-2">
              Recent activity
            </h3>
            <ActivityDrawer smeId={persona.id} accent={persona.color.fg} />
          </section>

          {/* Danger zone for user-created SMEs */}
          {!isBuiltIn && (
            <section className="px-5 py-4">
              <button
                type="button"
                onClick={() => void deletePersona()}
                className="text-[11px] font-medium text-red-500 hover:underline"
              >
                Delete {persona.name}
              </button>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="text-[9.5px] uppercase tracking-wider font-medium text-[var(--text-faint)]">
        {label}
      </div>
      <div className="text-[15px] font-semibold leading-none" style={{ color: accent }}>
        {value}
      </div>
      <div className="text-[10px] text-[var(--text-faint)]">{sub}</div>
    </div>
  );
}
