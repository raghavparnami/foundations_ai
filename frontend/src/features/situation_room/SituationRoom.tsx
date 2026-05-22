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
import { getPersona, getSnapshot } from "./fixtures";
import PinnedIncident from "./PinnedIncident";
import SMEStation from "./SMEStation";
import CommandBar from "./CommandBar";
import type { SituationRoomSnapshot } from "./types";

const POLL_MS = 30_000;

type Props = {
  onSubmit: (text: string) => void;
};

export default function SituationRoom({ onSubmit }: Props) {
  const [snapshot, setSnapshot] = useState<SituationRoomSnapshot>(() =>
    getSnapshot(),
  );
  const [now, setNow] = useState<Date>(() => new Date());

  // Poll the fixture every 30s — when the real endpoint lands, swap
  // getSnapshot() for a fetch and the rest of the component is unchanged.
  useEffect(() => {
    const iv = setInterval(() => setSnapshot(getSnapshot()), POLL_MS);
    return () => clearInterval(iv);
  }, []);

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
          <PinnedIncident incident={snapshot.pinned_incident} />
        )}

        {/* 3. SME grid */}
        <div
          aria-label="SME stations"
          className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3"
        >
          {snapshot.stations.map((s) => {
            const persona = getPersona(s.sme_id);
            if (!persona) return null;
            return (
              <SMEStation
                key={s.sme_id}
                persona={persona}
                station={s}
              />
            );
          })}
        </div>
      </div>

      {/* 4. Command bar */}
      <div className="mt-1">
        <CommandBar onSubmit={onSubmit} />
        <p className="mt-2 text-[10.5px] text-[var(--text-faint)] text-center">
          Press <kbd className="px-1 py-0.5 rounded bg-[var(--bg-soft)] border border-[var(--border)] text-[10px]">⌘K</kbd> to focus the bar.
        </p>
      </div>
    </section>
  );
}

function formatPlantTime(d: Date): string {
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}
