/**
 * Right-side Plan panel. Derives a step list from the live transcript
 * items for the current turn and renders status (pending / running /
 * done) next to each step.
 *
 * Two shapes of plan:
 *   1. SMEs route (handshake present)
 *        ✓ Convene IRIS, Mason
 *        ⏳ IRIS deliberating
 *        ✓ Mason deliberated
 *        □ Synthesize consensus
 *        □ Loom wraps up
 *   2. Direct route (no handshake)
 *        ⏳ Compose answer
 *
 * After turn_done the plan freezes (all steps complete) and stays
 * visible until the next user message starts a new turn.
 */
import { useMemo } from "react";
import { SMEIcon } from "../situation_room/icons";
import { getPersona } from "../situation_room/fixtures";
import type { TranscriptItem } from "./types";

type StepStatus = "pending" | "running" | "done";

type Step = {
  id: string;
  label: string;
  sme_id?: string;
  status: StepStatus;
};

type Props = {
  items: TranscriptItem[];
  busy: boolean;
};

export default function PlanPanel({ items, busy }: Props) {
  const steps = useMemo(() => derivePlan(items, busy), [items, busy]);

  if (steps.length === 0) {
    return (
      <aside
        aria-label="Plan"
        className="hidden xl:flex w-[260px] shrink-0 flex-col border-l border-[var(--color-border-tertiary)] bg-[var(--bg-soft)]/40"
      >
        <Header />
        <div className="px-4 py-3 text-[11.5px] text-[var(--text-faint)] italic">
          Loom will draft a plan once you ask something.
        </div>
      </aside>
    );
  }

  const remaining = steps.filter((s) => s.status !== "done").length;

  return (
    <aside
      aria-label="Plan"
      className="hidden xl:flex w-[260px] shrink-0 flex-col border-l border-[var(--color-border-tertiary)] bg-[var(--bg-soft)]/40 overflow-y-auto"
    >
      <Header remaining={remaining} total={steps.length} />
      <ol className="px-3 py-2 flex flex-col gap-1.5">
        {steps.map((s, idx) => (
          <StepRow key={s.id} step={s} idx={idx + 1} />
        ))}
      </ol>
    </aside>
  );
}

function Header({
  remaining,
  total,
}: {
  remaining?: number;
  total?: number;
}) {
  return (
    <div className="px-4 py-3 border-b border-[var(--color-border-tertiary)] flex items-center justify-between">
      <span className="text-[10.5px] uppercase tracking-wider font-medium text-[var(--text-muted)]">
        Plan
      </span>
      {typeof remaining === "number" && typeof total === "number" && (
        <span className="text-[10.5px] text-[var(--text-faint)] font-mono">
          {total - remaining}/{total}
        </span>
      )}
    </div>
  );
}

function StepRow({ step, idx }: { step: Step; idx: number }) {
  const persona = step.sme_id ? getPersona(step.sme_id) : null;
  const labelColor =
    step.status === "running"
      ? persona?.color.fg ?? "var(--accent)"
      : step.status === "done"
        ? "var(--text)"
        : "var(--text-muted)";
  return (
    <li
      className="flex items-start gap-2 px-2 py-1.5 rounded-md transition"
      style={{
        background:
          step.status === "running"
            ? persona?.color.bg ?? "var(--accent-soft)"
            : "transparent",
      }}
    >
      <span className="shrink-0 w-5 inline-flex items-center justify-center mt-0.5">
        <Pip status={step.status} accent={persona?.color.fg ?? "var(--accent)"} />
      </span>
      <span
        className="text-[10.5px] uppercase tracking-wider font-mono shrink-0 mt-0.5 w-4 text-[var(--text-faint)]"
      >
        {idx}
      </span>
      <div className="flex-1 min-w-0">
        <div
          className="text-[12px] leading-tight"
          style={{ color: labelColor }}
        >
          {step.label}
        </div>
        {persona && (
          <div className="mt-0.5 text-[10px] text-[var(--text-faint)] flex items-center gap-1">
            <SMEIcon name={persona.icon} size={10} />
            <span>{persona.role}</span>
          </div>
        )}
      </div>
    </li>
  );
}

function Pip({ status, accent }: { status: StepStatus; accent: string }) {
  if (status === "done") {
    return (
      <span
        className="inline-flex items-center justify-center rounded-full"
        style={{
          width: 14,
          height: 14,
          background: "var(--accent-soft)",
          color: "var(--accent)",
        }}
        aria-label="done"
      >
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none">
          <path
            d="M5 12l4 4L19 6"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  if (status === "running") {
    return (
      <span
        className="inline-block w-2 h-2 rounded-full animate-pulse"
        style={{ background: accent }}
        aria-label="running"
      />
    );
  }
  return (
    <span
      aria-label="pending"
      className="inline-block w-2 h-2 rounded-full border border-[var(--border-strong)]"
      style={{ background: "transparent" }}
    />
  );
}

// ─── plan derivation ─────────────────────────────────────────────────────


function derivePlan(items: TranscriptItem[], busy: boolean): Step[] {
  // 1. Scope to the CURRENT turn — everything since the last user message.
  let startIdx = -1;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it && it.kind === "speech" && it.speaker.kind === "user") {
      startIdx = i;
      break;
    }
  }
  if (startIdx < 0) return [];
  const slice = items.slice(startIdx);

  // 2. Inspect the slice.
  const handshake = slice.find((it) => it.kind === "handshake");
  const synthesis = slice.find((it) => it.kind === "synthesis");
  const meta = slice.find((it) => it.kind === "meta");
  const turnComplete = Boolean(meta);

  if (!handshake) {
    // Direct route — just one composing step.
    const loomSpoke = slice.some(
      (it) => it.kind === "speech" && it.speaker.kind === "loom",
    );
    return [
      {
        id: "compose",
        label: "Compose answer",
        status: turnComplete
          ? "done"
          : loomSpoke || busy
            ? "running"
            : "pending",
      },
    ];
  }

  // SMEs route
  const smeIds = handshake.smes;
  const smeNames = smeIds
    .map((s) => getPersona(s)?.name ?? s)
    .join(", ");
  const steps: Step[] = [];
  steps.push({
    id: "convene",
    label: `Convene ${smeNames}`,
    status: "done", // emitted == done
  });

  for (const sid of smeIds) {
    const speech = slice.find(
      (it) =>
        it.kind === "speech" &&
        it.speaker.kind === "sme" &&
        it.speaker.sme_id === sid,
    );
    let status: StepStatus = "pending";
    if (speech) {
      if (speech.kind === "speech") {
        status = speech.done ? "done" : "running";
      }
    }
    const persona = getPersona(sid);
    steps.push({
      id: `sme-${sid}`,
      sme_id: sid,
      label: persona ? `${persona.name} deliberates` : `${sid} deliberates`,
      status,
    });
  }

  // Synthesize step
  steps.push({
    id: "synth",
    label: "Synthesize consensus",
    status: synthesis ? "done" : turnComplete ? "done" : steps.every((s) => s.status === "done") && busy ? "running" : "pending",
  });

  // Wrap up: a Loom speech AFTER synthesis is the wrap-up.
  let loomWrapStatus: StepStatus = "pending";
  if (turnComplete) loomWrapStatus = "done";
  else if (synthesis) {
    const idx = slice.indexOf(synthesis);
    const wrap = slice.slice(idx + 1).find(
      (it) => it.kind === "speech" && it.speaker.kind === "loom",
    );
    if (wrap && wrap.kind === "speech") {
      loomWrapStatus = wrap.done ? "done" : "running";
    } else {
      loomWrapStatus = busy ? "running" : "pending";
    }
  }
  steps.push({
    id: "wrap",
    label: "Loom wraps up",
    status: loomWrapStatus,
  });

  return steps;
}
