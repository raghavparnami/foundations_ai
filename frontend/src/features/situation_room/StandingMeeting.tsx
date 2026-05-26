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
import { useEffect, useMemo, useRef, useState } from "react";
import { SME_ROSTER, getPersona } from "./fixtures";
import {
  closeDecision,
  openDecision,
  synthesize,
  type Decision,
  type SynthResponse,
} from "./ledger";
import { selectSMEs } from "./selectSMEs";
import SMEColumn from "./SMEColumn";
import { useAllPersonas } from "./useCustomPersonas";
import type { SMEPersona, SMEStation } from "./types";

type Props = {
  question: string;
  /** "ad-hoc" | "briefing" | "sme" — passed through to the ledger row. */
  kind?: "ad-hoc" | "briefing" | "sme";
  pinnedId?: string | null;
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
  kind = "ad-hoc",
  pinnedId = null,
  forcedPanel,
  contextLabel,
  findings,
  onClose,
}: Props) {
  const { personas: allPersonas } = useAllPersonas();
  const lookupPersona = (id: string) =>
    allPersonas.find((p) => p.id === id) ?? getPersona(id);

  const initial = useMemo(() => {
    if (forcedPanel && forcedPanel.length > 0) {
      const resolved = forcedPanel
        .map((id) => lookupPersona(id))
        .filter((p): p is SMEPersona => Boolean(p));
      if (resolved.length > 0) return resolved;
    }
    return selectSMEs(question, allPersonas.length ? allPersonas : SME_ROSTER);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question, forcedPanel, allPersonas.length]);
  const [panel, setPanel] = useState<SMEPersona[]>(initial);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [synth, setSynth] = useState<SynthResponse | null>(null);
  const answersRef = useRef<Record<string, { text: string; ok: boolean }>>({});
  const synthRunRef = useRef(false);

  // Open a ledger row when this meeting mounts. Re-open if the question
  // changes (the parent re-keys us so this fires once per meeting anyway).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await openDecision({
          kind,
          question,
          panel: panel.map((p) => p.id),
          context_label: contextLabel ?? null,
          pinned_id: pinnedId,
        });
        if (!cancelled) setDecision(d);
      } catch {
        // Ledger is best-effort; meeting still works without it.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question]);

  function handleColumnComplete(smeId: string, text: string, ok: boolean) {
    answersRef.current[smeId] = { text, ok };
    // Run synthesize once every panel member has a final answer.
    if (Object.keys(answersRef.current).length < panel.length) return;
    if (synthRunRef.current) return;
    synthRunRef.current = true;
    const list = panel
      .map((p) => ({
        sme_id: p.id,
        text: (answersRef.current[p.id]?.text ?? "").trim(),
      }))
      .filter((a) => a.text.length > 20);
    if (list.length < 2) return;
    (async () => {
      try {
        const s = await synthesize(list);
        setSynth(s);
      } catch {
        // ignore
      }
    })();
  }

  const benchSource = allPersonas.length ? allPersonas : SME_ROSTER;
  const bench = benchSource.filter((p) => !panel.find((x) => x.id === p.id));
  const next = bench[0];

  function bringIn() {
    if (!next) return;
    synthRunRef.current = false; // re-run synth after the new column finishes
    setSynth(null);
    setPanel((p) => [...p, next]);
  }

  async function handleClose() {
    if (decision) {
      try {
        const receipts: Record<string, unknown> = {};
        for (const [sid, a] of Object.entries(answersRef.current)) {
          receipts[sid] = { text: a.text, ok: a.ok };
        }
        if (synth) receipts["_synthesis"] = synth;
        await closeDecision(decision.slug, { receipts });
      } catch {
        // best-effort
      }
    }
    onClose();
  }

  const dissentBySme = useMemo(() => {
    const m: Record<string, string> = {};
    for (const d of synth?.dissenters ?? []) m[d.sme_id] = d.reason;
    return m;
  }, [synth]);

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
            onClick={() => void handleClose()}
            className="text-[12px] font-medium px-3 py-1.5 rounded-full bg-[var(--color-background-primary)] text-[var(--text-muted)] hover:text-[var(--text)] transition"
            style={{ border: "0.5px solid var(--color-border-tertiary)" }}
          >
            Close meeting
          </button>
        </div>
      </header>

      <div className={`grid gap-3 ${gridCols}`}>
        {panel.map((persona) => {
          const f = findings?.[persona.id];
          return (
            <SMEColumn
              key={persona.id}
              persona={persona}
              question={question}
              contextFinding={f?.current_finding ?? null}
              evidenceSql={f?.evidence_sql ?? null}
              evidenceRow={f?.evidence_row ?? null}
              disagreeing={Boolean(dissentBySme[persona.id])}
              dissentReason={dissentBySme[persona.id] ?? null}
              decisionSlug={decision?.slug ?? null}
              onComplete={handleColumnComplete}
            />
          );
        })}
      </div>

      <footer className="text-[11.5px] flex items-start justify-between gap-3 pt-1">
        <div className="min-w-0 flex-1">
          {synth ? (
            <span className="text-[var(--text)]">
              <span className="text-[var(--text-faint)] uppercase tracking-wider text-[10px] font-medium mr-2">Consensus</span>
              {synth.consensus_summary}
              {synth.dissenters.length > 0 && (
                <>
                  {" · "}
                  <span className="text-[var(--text-muted)]">
                    {synth.dissenters
                      .map((d) => {
                        const p = lookupPersona(d.sme_id);
                        return p ? p.name : d.sme_id;
                      })
                      .join(", ")}{" "}
                    dissenting
                  </span>
                </>
              )}
            </span>
          ) : (
            <span className="text-[var(--text-faint)]">
              {panel.map((p) => p.name).join(" · ")}
            </span>
          )}
        </div>
        <span className="text-[var(--text-faint)] text-[10.5px] shrink-0">
          {decision ? `ledger · ${decision.slug}` : "logging…"}
        </span>
      </footer>
    </section>
  );
}
