/**
 * One station card in the Situation Room grid.
 *
 * Layout: avatar pip + name/role on top, status dot + label, then the
 * one-line current finding. Alerting cards get an orange accent border.
 * Clicking the card opens the Phase-2 stub (a small modal that says
 * "Standing Meeting view coming in Phase 2").
 */
import { useEffect, useState } from "react";
import { api, ApiError } from "../../lib/api";
import ActivityDrawer from "./ActivityDrawer";
import { SMEIcon } from "./icons";
import KnowledgePanel from "./KnowledgePanel";
import Sparkline from "./Sparkline";
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
  /** Per-SME calibration · "84% over 47 cases" badge. */
  calibration?: { total: number; up: number; down: number; accuracy: number | null } | null;
  /** Running LLM cost attributed to this SME (this shift). */
  spend?: { calls: number; tokens: number; cost_usd: number } | null;
  /** Called when the user clicks the card. Phase 2: opens a one-column
   *  Standing Meeting seeded with this SME's current finding. */
  onConvene?: (persona: SMEPersona, station: SMEStation) => void;
};

function formatTrail(v: number): string {
  if (v === 0) return "0";
  if (v < 1) return v.toFixed(2);
  if (v < 10) return v.toFixed(1);
  return Math.round(v).toString();
}

function formatChipUsd(v: number): string {
  if (v === 0) return "$0.00";
  if (v < 0.01) return "<$0.01";
  return `$${v.toFixed(2)}`;
}

export default function SMEStation({ persona, station, calibration, spend, onConvene }: Props) {
  const alerting = station.status === "alerting";
  const [teachOpen, setTeachOpen] = useState(false);
  const [knowledgeCount, setKnowledgeCount] = useState<number>(0);
  const [activityOpen, setActivityOpen] = useState(false);

  // Fetch the count once on mount so we can show a badge. Cheap GET.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await api.get<{ enabled: boolean }[]>(
          `/api/sme/${persona.id}/knowledge`,
        );
        if (alive) setKnowledgeCount(list.filter((n) => n.enabled).length);
      } catch (e) {
        // 404 / unreachable backend → leave at 0
        if (!(e instanceof ApiError) && !alive) return;
      }
    })();
    return () => {
      alive = false;
    };
  }, [persona.id]);

  return (
    <>
    <div className="relative">
      <button
        type="button"
        onClick={() => onConvene?.(persona, station)}
        aria-label={`${persona.name}, ${persona.role}, ${station.status_label}. ${station.current_finding}. Click to convene.`}
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
            {calibration && calibration.total >= 3 && calibration.accuracy !== null && (
              <div
                className="text-[10px] leading-tight mt-0.5"
                title={`${calibration.up} useful · ${calibration.down} not over ${calibration.total} rated`}
                style={{ color: persona.color.fg }}
              >
                {Math.round(calibration.accuracy * 100)}% useful · {calibration.total} cases
              </div>
            )}
            {spend && spend.calls > 0 && (
              <div
                className="text-[10px] leading-tight mt-0.5 text-[var(--text-faint)]"
                title={`${spend.calls} LLM call${spend.calls === 1 ? "" : "s"} · ${spend.tokens.toLocaleString()} tokens this shift`}
              >
                {formatChipUsd(spend.cost_usd)} this shift · {spend.calls} call{spend.calls === 1 ? "" : "s"}
              </div>
            )}
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

        <div className="mt-2 flex items-end justify-between gap-3">
          <p className="text-[12.5px] leading-snug text-[var(--text)] flex-1 min-w-0">
            {station.current_finding}
          </p>
          {station.trail && station.trail.length > 0 && (
            <span
              title={`Last 7 days: ${station.trail.map((v) => formatTrail(v)).join(", ")}`}
              className="shrink-0"
            >
              <Sparkline
                values={station.trail}
                stroke={persona.color.fg}
                fill={persona.color.bg}
              />
            </span>
          )}
        </div>

        {/* Skills / domain chips + learned-count. Sits inside the
            card-click button so a click anywhere on the card still
            opens the meeting. */}
        <div className="mt-3 flex flex-wrap gap-1 items-center">
          {persona.domain.slice(0, 4).map((d) => (
            <span
              key={d}
              className="text-[10px] font-medium px-1.5 py-0.5 rounded"
              style={{
                background: "var(--bg-soft)",
                color: "var(--text-muted)",
                border: "0.5px solid var(--color-border-tertiary)",
              }}
            >
              {d}
            </span>
          ))}
          {knowledgeCount > 0 && (
            <span
              className="text-[10px] font-medium px-1.5 py-0.5 rounded"
              title={`${knowledgeCount} user-taught note${knowledgeCount === 1 ? "" : "s"}`}
              style={{
                background: persona.color.bg,
                color: persona.color.fg,
                border: `0.5px solid ${persona.color.fg}33`,
              }}
            >
              +{knowledgeCount} learned
            </span>
          )}
        </div>
      </button>

      {/* Activity disclosure — small toggle below the card to expand the
          recent-events feed. Floated as a separate non-button (the parent
          <div className="relative"> already contains the click button) so
          clicking it doesn't fire the convene. */}
      <div className="mt-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setActivityOpen((v) => !v);
          }}
          className="text-[10.5px] uppercase tracking-wider font-medium text-[var(--text-faint)] hover:text-[var(--text)] transition flex items-center gap-1"
        >
          <span aria-hidden>{activityOpen ? "▾" : "▸"}</span>
          Activity
        </button>
        {activityOpen && (
          <ActivityDrawer smeId={persona.id} accent={persona.color.fg} />
        )}
      </div>

      {/* Teach button — uniform 24×24 icon-only at the top-right. The
          underlying button owns the rest of the card click area; this
          floats above it with stopPropagation. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setTeachOpen(true);
        }}
        title={
          knowledgeCount > 0
            ? `Teach ${persona.name} — ${knowledgeCount} note${knowledgeCount === 1 ? "" : "s"}`
            : `Teach ${persona.name}`
        }
        aria-label={`Teach ${persona.name}, ${knowledgeCount} notes`}
        className="absolute top-2 right-2 w-6 h-6 inline-flex items-center justify-center rounded-md text-[var(--text-faint)] hover:text-[var(--text)] hover:bg-[var(--bg-soft)] transition"
      >
        <svg
          width="12" height="12" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="1.7"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4z" />
        </svg>
        {knowledgeCount > 0 && (
          <span
            aria-hidden
            className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-full text-[9px] font-semibold leading-none"
            style={{
              background: persona.color.fg,
              color: "#fff",
            }}
          >
            {knowledgeCount}
          </span>
        )}
      </button>
    </div>
    {teachOpen && (
      <KnowledgePanel
        persona={persona}
        onChange={setKnowledgeCount}
        onClose={() => setTeachOpen(false)}
      />
    )}
    </>
  );
}
