/**
 * One SME tile in the Console wall. Big stat card, persona-color avatar,
 * one-line finding, sparkline, status pill, foot row with cal/spend.
 *
 * Clicking opens the detail drawer (teach / activity / etc.).
 */
import Sparkline from "../situation_room/Sparkline";
import { SMEIcon } from "../situation_room/icons";
import type { SMEPersona, SMEStation } from "../situation_room/types";

type Props = {
  persona: SMEPersona;
  station?: SMEStation;
  calibration?: { total: number; accuracy: number | null } | null;
  spend?: { cost_usd: number; calls: number } | null;
  onClick?: () => void;
};

const STATUS_PILL: Record<string, { bg: string; fg: string; label: string }> = {
  alerting: { bg: "#FDDDD4", fg: "#993C1D", label: "Alerting" },
  recommending: { bg: "#E0DCFE", fg: "#534AB7", label: "Recommending" },
  watching: { bg: "#E1F5EE", fg: "#0F6E56", label: "Watching" },
  idle: { bg: "var(--bg-soft)", fg: "var(--text-muted)", label: "Idle" },
};

export default function ConsoleTile({
  persona,
  station,
  calibration,
  spend,
  onClick,
}: Props) {
  const status = station?.status ?? "idle";
  const pill = STATUS_PILL[status] ?? STATUS_PILL.idle!;
  const alerting = status === "alerting";

  return (
    <article
      className={"console-tile" + (alerting ? " console-tile--alerting" : "")}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
      aria-label={`${persona.name} ${persona.role} ${pill.label}`}
    >
      <div className="console-tile__head">
        <span
          className="console-tile__avatar"
          style={{ background: persona.color.bg, color: persona.color.fg }}
          aria-hidden
        >
          <SMEIcon name={persona.icon} size={17} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="console-tile__name">{persona.name}</div>
          <div className="console-tile__role">{persona.role}</div>
        </div>
        <span
          className="console-tile__status"
          style={{ background: pill.bg, color: pill.fg }}
        >
          {pill.label}
        </span>
      </div>

      <div className="console-tile__finding">
        {station?.current_finding ?? "Awaiting probe data…"}
      </div>

      {station?.trail && station.trail.length > 0 && (
        <div className="console-tile__spark">
          <Sparkline
            values={station.trail}
            stroke={persona.color.fg}
            fill={persona.color.bg}
            width={240}
            height={28}
          />
        </div>
      )}

      <div className="console-tile__foot">
        <span className="console-tile__metric">
          {calibration && calibration.total >= 1 && calibration.accuracy !== null ? (
            <span
              className="console-tile__metric-val"
              style={{ color: persona.color.fg }}
            >
              {Math.round(calibration.accuracy * 100)}% useful
            </span>
          ) : (
            <span className="console-tile__metric-val">no ratings yet</span>
          )}
        </span>
        <span className="console-tile__metric">
          <span className="console-tile__metric-val">
            {spend && spend.calls > 0
              ? `$${spend.cost_usd.toFixed(3)} · ${spend.calls}`
              : "no spend"}
          </span>
        </span>
      </div>
    </article>
  );
}
