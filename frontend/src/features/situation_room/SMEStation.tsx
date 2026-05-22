/**
 * One station card in the Situation Room grid.
 *
 * Layout: avatar pip + name/role on top, status dot + label, then the
 * one-line current finding. Alerting cards get an orange accent border.
 * Clicking the card opens the Phase-2 stub (a small modal that says
 * "Standing Meeting view coming in Phase 2").
 */
import { useState } from "react";
import { SMEIcon } from "./icons";
import { StubModal } from "./StubModal";
import type { SMEPersona, SMEStation, SMEStatus } from "./types";

const STATUS_DOT: Record<SMEStatus, string> = {
  watching: "#1D9E75",
  alerting: "#D85A30",
  recommending: "#534AB7",
  idle: "#B4B2A9",
};

const ALERT_BORDER = "#F0997B";

type Props = {
  persona: SMEPersona;
  station: SMEStation;
};

export default function SMEStation({ persona, station }: Props) {
  const [open, setOpen] = useState(false);
  const alerting = station.status === "alerting";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${persona.name}, ${persona.role}, ${station.status_label}. ${station.current_finding}`}
        className="text-left rounded-md bg-[var(--color-background-primary)] p-4 transition hover:shadow-[0_2px_18px_rgba(20,21,42,0.06)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
        style={{
          border: alerting
            ? `0.5px solid ${ALERT_BORDER}`
            : "0.5px solid var(--color-border-tertiary)",
        }}
      >
        <div className="flex items-center gap-3">
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
          <div className="min-w-0">
            <div className="text-[13.5px] font-medium text-[var(--text)] leading-tight">
              {persona.name}
            </div>
            <div className="text-[11.5px] text-[var(--text-muted)] leading-tight mt-0.5">
              {persona.role}
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-1.5">
          <span
            aria-label={station.status}
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ background: STATUS_DOT[station.status] }}
          />
          <span
            className="text-[11px] font-medium uppercase tracking-wider"
            style={{
              color:
                station.status === "alerting"
                  ? "#993C1D"
                  : "var(--text-muted)",
            }}
          >
            {station.status_label}
          </span>
        </div>

        <p className="mt-2 text-[12.5px] leading-snug text-[var(--text)]">
          {station.current_finding}
        </p>
      </button>

      {open && (
        <StubModal
          title={`${persona.name} · ${persona.role}`}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
