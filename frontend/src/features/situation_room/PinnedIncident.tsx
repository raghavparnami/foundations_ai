/**
 * Pinned-incident strip — renders above the SME grid when there is an
 * active high-priority alert. Amber palette by default, red for critical.
 * The "Join briefing →" link opens the Phase-2 stub.
 */
import { AlertTriangleIcon } from "./icons";
import type { PinnedIncident as Incident } from "./types";

type Props = {
  incident: Incident;
  onJoinBriefing?: (incident: Incident) => void;
};

type Palette = {
  bg: string;
  border: string;
  iconBg: string;
  iconFg: string;
  text: string;
  subtext: string;
};

const PALETTE: Record<Incident["severity"], Palette> = {
  warning: {
    bg: "#FAEEDA",
    border: "#BA7517",
    iconBg: "#F3D9A8",
    iconFg: "#7A4A0F",
    text: "#3B2A0F",
    subtext: "#7A5A29",
  },
  critical: {
    bg: "#FBE5E1",
    border: "#B33A21",
    iconBg: "#F2BFB5",
    iconFg: "#7A2412",
    text: "#3A100A",
    subtext: "#7A3024",
  },
  info: {
    bg: "var(--accent-soft)",
    border: "var(--accent)",
    iconBg: "#dee2ff",
    iconFg: "#3a47c4",
    text: "var(--text)",
    subtext: "var(--text-muted)",
  },
};

export default function PinnedIncident({ incident, onJoinBriefing }: Props) {
  const p = PALETTE[incident.severity];

  return (
    <div
      role="alert"
      aria-label={incident.headline}
      className="rounded-md flex items-center gap-3 px-4 py-3"
      style={{
        background: p.bg,
        borderLeft: `3px solid ${p.border}`,
      }}
    >
      <span
        aria-hidden
        className="inline-flex items-center justify-center rounded-full shrink-0"
        style={{ width: 28, height: 28, background: p.iconBg, color: p.iconFg }}
      >
        <AlertTriangleIcon size={16} />
      </span>
      <div className="flex-1 min-w-0">
        <div
          className="text-[13.5px] font-medium leading-tight truncate"
          style={{ color: p.text }}
        >
          {incident.headline}
        </div>
        <div
          className="text-[11.5px] leading-tight mt-1 truncate"
          style={{ color: p.subtext }}
        >
          {incident.subtext}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onJoinBriefing?.(incident)}
        className="text-[12.5px] font-medium underline decoration-dotted underline-offset-4 hover:no-underline shrink-0"
        style={{ color: p.text }}
      >
        Join briefing →
      </button>
    </div>
  );
}
