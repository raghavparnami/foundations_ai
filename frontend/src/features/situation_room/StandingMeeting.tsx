/**
 * Phase 2 Standing Meeting panel.
 *
 * When the user submits a question via the Situation Room command bar, the
 * panel mounts below the SME grid and convenes 2-4 SMEs picked by
 * `selectSMEs`. Each SME deliberates in their own column in parallel.
 *
 * The footer summarises status ("3 answering · 1 done") and exposes two
 * action buttons:
 *   - Bring in [SME]  — adds the next-best matched persona to the panel
 *   - Close meeting   — clears the panel and returns to the room
 *
 * Phase 3 will add: receipt links per claim, calibration scores, decisions
 * ledger entry. Phase 2 v1 keeps the visual mechanism but no real receipts.
 */
import { useMemo, useState } from "react";
import { SME_ROSTER, getPersona } from "./fixtures";
import { selectSMEs } from "./selectSMEs";
import SMEColumn from "./SMEColumn";
import type { SMEPersona, SMEStation } from "./types";

type Props = {
  question: string;
  /**
   * Override the auto-selected panel. Used when the user clicks "Join
   * briefing" on a pinned incident — the incident's `converging_sme_ids`
   * become the panel directly, instead of running keyword selection.
   */
  forcedPanel?: readonly string[];
  /** Optional pre-amble shown above the question. e.g. "Incident · started 13:04". */
  contextLabel?: string;
  /** Live findings keyed by sme_id (from /api/situation-room/snapshot). Passed
   *  through to each SME column so the LLM can analyse directly instead of
   *  re-querying the catalog. */
  findings?: Record<string, SMEStation>;
  onClose: () => void;
};

export default function StandingMeeting({
  question,
  forcedPanel,
  contextLabel,
  findings,
  onClose,
}: Props) {
  const initial = useMemo(() => {
    if (forcedPanel && forcedPanel.length > 0) {
      const resolved = forcedPanel
        .map((id) => getPersona(id))
        .filter((p): p is SMEPersona => Boolean(p));
      if (resolved.length > 0) return resolved;
    }
    return selectSMEs(question, SME_ROSTER);
  }, [question, forcedPanel]);
  const [panel, setPanel] = useState<SMEPersona[]>(initial);

  const bench = SME_ROSTER.filter((p) => !panel.find((x) => x.id === p.id));
  const next = bench[0];

  function bringIn() {
    if (!next) return;
    setPanel((p) => [...p, next]);
  }

  const cols = panel.length;
  const gridCols =
    cols >= 4
      ? "lg:grid-cols-4 md:grid-cols-2 grid-cols-1"
      : cols === 3
        ? "lg:grid-cols-3 md:grid-cols-2 grid-cols-1"
        : "md:grid-cols-2 grid-cols-1";

  return (
    <section
      aria-label="Standing Meeting"
      className="rounded-xl p-3 sm:p-4 flex flex-col gap-3"
      style={{
        background: "var(--color-background-secondary)",
        borderRadius: "var(--border-radius-lg)",
      }}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] uppercase tracking-wider font-medium text-[var(--text-faint)]">
            {contextLabel ?? `Standing Meeting · ${cols} SME${cols === 1 ? "" : "s"} convened`}
          </div>
          <h2 className="mt-1 text-[15px] font-medium text-[var(--text)] leading-snug">
            {question}
          </h2>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {next && (
            <button
              type="button"
              onClick={bringIn}
              className="text-[12px] font-medium px-3 py-1.5 rounded-full bg-[var(--color-background-primary)] text-[var(--text-muted)] hover:text-[var(--text)] transition"
              style={{ border: "0.5px solid var(--color-border-tertiary)" }}
              title={`Bring ${next.name} into the meeting`}
            >
              + Bring in {next.name}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="text-[12px] font-medium px-3 py-1.5 rounded-full bg-[var(--color-background-primary)] text-[var(--text-muted)] hover:text-[var(--text)] transition"
            style={{ border: "0.5px solid var(--color-border-tertiary)" }}
          >
            Close meeting
          </button>
        </div>
      </header>

      <div className={`grid gap-3 ${gridCols}`}>
        {panel.map((persona) => (
          <SMEColumn
            key={persona.id}
            persona={persona}
            question={question}
            contextFinding={findings?.[persona.id]?.current_finding ?? null}
          />
        ))}
      </div>

      <footer className="text-[11px] text-[var(--text-muted)] flex items-center justify-between pt-1">
        <span>
          {panel.map((p) => p.name).join(" · ")}
        </span>
        <span className="text-[var(--text-faint)]">
          Receipts and decisions ledger arrive in Phase 3.
        </span>
      </footer>
    </section>
  );
}
