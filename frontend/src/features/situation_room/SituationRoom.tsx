/**
 * Phase 1 — Situation Room.
 *
 * Replaces Chat.tsx's `EmptyHero` (and the four ActionChips inside the
 * existing input pill) when `flag.situation_room_enabled` is on. Owns its
 * own bottom command bar; on submit, hands the text to the existing
 * `streamChat` pipeline via `onSubmit`, which immediately mounts the chat
 * turn list and unmounts this view.
 *
 * Layout, top to bottom:
 *   1. Status strip   — "SITUATION ROOM · DAY SHIFT" | plant time + SMEs on duty
 *   2. Pinned card    — optional warning/critical strip
 *   3. SME grid       — 3×2 desktop, 2×3 tablet, 1×6 mobile
 *   4. Command bar    — pinned to bottom of the content area (not viewport)
 */
import { useEffect, useMemo, useState } from "react";
import { SME_ROSTER, getPersona } from "./fixtures";
import { useAllPersonas } from "./useCustomPersonas";
import NewSMEModal from "./NewSMEModal";
import PinnedIncident from "./PinnedIncident";
import SMEStation from "./SMEStation";
import CommandBar from "./CommandBar";
import StandingMeeting from "./StandingMeeting";
import { useSnapshot } from "./useSnapshot";
import { useCostMeter, formatUsd } from "./useCostMeter";
import { useCalibration } from "./useCalibration";
import type {
  PinnedIncident as Incident,
  SMEPersona,
  SMEStation as SMEStationType,
} from "./types";

type MeetingState =
  | { kind: "ad-hoc"; question: string }
  | { kind: "briefing"; question: string; converging: string[]; contextLabel: string }
  | { kind: "sme"; question: string; smeId: string; contextLabel: string };


type Props = {
  /**
   * Optional handoff into the legacy chat pipeline. Unused in Phase 2 — the
   * command bar now opens an inline Standing Meeting below the grid instead
   * of replacing the whole view with a chat thread. Kept for compatibility
   * and for the "Accept finding" path Phase 3 will add.
   */
  onSubmit?: (text: string) => void;
};

export default function SituationRoom(_props: Props) {
  const { snapshot, source, lastError } = useSnapshot();
  const { personas, refresh: refreshPersonas } = useAllPersonas();
  const meter = useCostMeter();
  const calibration = useCalibration();
  const [now, setNow] = useState<Date>(() => new Date());
  const [meeting, setMeeting] = useState<MeetingState | null>(null);
  const [showNewSme, setShowNewSme] = useState(false);

  function personaById(sid: string) {
    return personas.find((p) => p.id === sid) ?? getPersona(sid);
  }

  function openBriefing(incident: Incident): void {
    setMeeting({
      kind: "briefing",
      question: incident.headline,
      converging: incident.converging_sme_ids,
      contextLabel: `Briefing · ${incident.subtext}`,
    });
  }

  function handleCommand(raw: string): void {
    // @-mention shortcut: '@Marcus what about LINE-B?' opens a one-SME
    // meeting with Marcus, stripping the @-tag from the question text.
    const m = raw.match(/^\s*@(\w+)\s+(.+)$/);
    if (m) {
      const name = m[1]!.toLowerCase();
      const rest = m[2]!.trim();
      const persona = SME_ROSTER.find(
        (p) => p.id.toLowerCase() === name || p.name.toLowerCase() === name,
      );
      if (persona) {
        setMeeting({
          kind: "sme",
          question: rest,
          smeId: persona.id,
          contextLabel: `Direct · ${persona.name} only`,
        });
        return;
      }
    }
    setMeeting({ kind: "ad-hoc", question: raw });
  }

  function openSMEMeeting(persona: SMEPersona, station: SMEStationType): void {
    setMeeting({
      kind: "sme",
      question: `${persona.name} (${persona.role}): tell me more about — ${station.current_finding}`,
      smeId: persona.id,
      contextLabel: `Brief from ${persona.name} · ${station.status_label.toLowerCase()}`,
    });
  }

  // Plant-time tick (every minute).
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(iv);
  }, []);

  const plantTime = useMemo(() => formatPlantTime(now), [now]);
  const onDuty = snapshot.stations.length;

  return (
    <section
      aria-label="Situation Room"
      className="situation-room flex flex-col gap-3 px-6 py-5 max-w-[1180px] mx-auto w-full"
    >
      {/* 1. Status strip */}
      <header className="flex items-center justify-between text-[11px] tracking-wider uppercase">
        <span className="text-[var(--text-muted)] font-medium">
          Situation Room · <span style={{ letterSpacing: "0.08em" }}>{snapshot.shift_label}</span>
        </span>
        <span className="text-[var(--text-faint)] font-medium flex items-center gap-2 normal-case tracking-normal text-[11.5px]">
          <span
            title={
              source === "live"
                ? "Live from /api/situation-room/snapshot"
                : (lastError ?? "Falling back to fixture")
            }
            className="text-[10px] uppercase tracking-wider font-medium"
            style={{
              color: source === "live" ? "#1D9E75" : "#B4B2A9",
            }}
          >
            {source === "live" ? "● Live" : "○ Fixture"}
          </span>
          <span aria-hidden>·</span>
          <span>{plantTime} plant time</span>
          <span aria-hidden>·</span>
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ background: "#1D9E75" }}
            />
            {onDuty} SMEs on duty
          </span>
          {meter && (
            <>
              <span aria-hidden>·</span>
              <span
                title={`${meter.total.calls} LLM calls · ${(meter.total.prompt_tokens + meter.total.completion_tokens).toLocaleString()} tokens since service start`}
                className="text-[var(--text-muted)]"
              >
                {formatUsd(meter.total.cost_usd)} · {meter.total.calls} calls
              </span>
            </>
          )}
        </span>
      </header>

      {/* Container with the secondary background wrapping pinned + grid */}
      <div
        className="rounded-xl p-3 sm:p-4 flex flex-col gap-3"
        style={{
          background: "var(--color-background-secondary)",
          borderRadius: "var(--border-radius-lg)",
        }}
      >
        {/* 2. Pinned incident */}
        {snapshot.pinned_incident && (
          <PinnedIncident
            incident={snapshot.pinned_incident}
            onJoinBriefing={openBriefing}
          />
        )}

        {/* 3. SME grid */}
        <div
          aria-label="SME stations"
          className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3"
        >
          {snapshot.stations.map((s) => {
            const persona = personaById(s.sme_id);
            if (!persona) return null;
            return (
              <SMEStation
                key={s.sme_id}
                persona={persona}
                station={s}
                calibration={calibration[s.sme_id] ?? null}
                onConvene={openSMEMeeting}
              />
            );
          })}
          {/* "+ Add SME" tile */}
          <button
            type="button"
            onClick={() => setShowNewSme(true)}
            aria-label="Add a new SME"
            className="rounded-md flex flex-col items-center justify-center p-6 gap-2 transition hover:bg-[var(--bg-elev)]"
            style={{
              background: "var(--color-background-primary)",
              border: "1px dashed var(--color-border-tertiary)",
              minHeight: 180,
              color: "var(--text-muted)",
            }}
          >
            <span
              aria-hidden
              className="inline-flex items-center justify-center rounded-full"
              style={{
                width: 36,
                height: 36,
                background: "var(--bg-soft)",
                color: "var(--text-faint)",
                fontSize: 20,
                fontWeight: 300,
              }}
            >
              +
            </span>
            <span className="text-[12.5px] font-medium">Add a new SME</span>
            <span className="text-[11px] text-[var(--text-faint)] text-center max-w-[180px]">
              Teach-only · starts in 'watching', learns from your notes
            </span>
          </button>
        </div>
      </div>

      {/* 4. Standing Meeting (Phase 2) — opens below the grid on submit or
              when the user clicks "Join briefing" on a pinned incident. */}
      {meeting && (
        <StandingMeeting
          key={`${meeting.kind}-${meeting.question}`}
          kind={meeting.kind}
          pinnedId={
            meeting.kind === "briefing"
              ? snapshot.pinned_incident?.id ?? null
              : null
          }
          question={meeting.question}
          forcedPanel={
            meeting.kind === "briefing"
              ? meeting.converging
              : meeting.kind === "sme"
                ? [meeting.smeId]
                : undefined
          }
          contextLabel={
            meeting.kind === "ad-hoc" ? undefined : meeting.contextLabel
          }
          findings={Object.fromEntries(
            snapshot.stations.map((s) => [s.sme_id, s]),
          )}
          onClose={() => setMeeting(null)}
        />
      )}

      {/* 5. Command bar */}
      <div className="mt-1">
        <CommandBar onSubmit={handleCommand} />
        <p className="mt-2 text-[10.5px] text-[var(--text-faint)] text-center">
          Press <kbd className="px-1 py-0.5 rounded bg-[var(--bg-soft)] border border-[var(--border)] text-[10px]">⌘K</kbd> to focus the bar. Asking convenes a Standing Meeting.
        </p>
      </div>

      {showNewSme && (
        <NewSMEModal
          onClose={() => setShowNewSme(false)}
          onCreated={() => void refreshPersonas()}
        />
      )}
    </section>
  );
}

function formatPlantTime(d: Date): string {
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}
