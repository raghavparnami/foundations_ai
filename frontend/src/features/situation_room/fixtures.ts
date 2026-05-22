/**
 * Phase 1 fixture data for the Situation Room.
 *
 * Sourced verbatim from the approved mockup (spec §4.6). When the backend
 * exposes a real endpoint, swap `getSnapshot()` for a fetch — every consumer
 * already reads through that function.
 */
import type {
  PinnedIncident,
  SituationRoomSnapshot,
  SMEPersona,
  SMEStation,
} from "./types";

export const SME_ROSTER: readonly SMEPersona[] = [
  {
    id: "marcus",
    name: "Marcus",
    role: "Mfg Engineer",
    icon: "settings-cog",
    color: { bg: "#EEEDFE", fg: "#534AB7" },
    domain: ["oee", "throughput", "changeover", "downtime"],
  },
  {
    id: "iris",
    name: "IRIS",
    role: "IIoT · Sensors",
    icon: "broadcast",
    color: { bg: "#FAECE7", fg: "#993C1D" },
    domain: ["telemetry", "anomaly", "vibration", "temperature"],
  },
  {
    id: "quinn",
    name: "Quinn",
    role: "Quality · SPC",
    icon: "target",
    color: { bg: "#E1F5EE", fg: "#0F6E56" },
    domain: ["cpk", "defect_rate", "spc", "tolerance"],
  },
  {
    id: "sasha",
    name: "Sasha",
    role: "Supply Chain",
    icon: "truck-delivery",
    color: { bg: "#E6F1FB", fg: "#185FA5" },
    domain: ["inventory", "lead_time", "supplier_risk"],
  },
  {
    id: "mason",
    name: "Mason",
    role: "Maintenance",
    icon: "tool",
    color: { bg: "#FBEAF0", fg: "#993556" },
    domain: ["mtbf", "predictive", "work_orders"],
  },
  {
    id: "sage",
    name: "Sage",
    role: "Safety · Compliance",
    icon: "shield-check",
    color: { bg: "#F1EFE8", fg: "#5F5E5A" },
    domain: ["incidents", "audit", "regulatory"],
    powers: ["veto"], // Phase 3 — unused today.
  },
] as const;

const NOW = new Date().toISOString();

const STATIONS: SMEStation[] = [
  {
    sme_id: "marcus",
    status: "watching",
    status_label: "Now watching",
    current_finding: "OEE drift across 4 lines · changeover variance Line 4",
    last_updated: NOW,
  },
  {
    sme_id: "iris",
    status: "alerting",
    status_label: "Alerting",
    current_finding: "Vibration anomaly · Pump 7 · 3.2σ above baseline",
    last_updated: NOW,
  },
  {
    sme_id: "quinn",
    status: "watching",
    status_label: "Now watching",
    current_finding: "CpK on tolerance X drifting · 1.41 → 1.18",
    last_updated: NOW,
  },
  {
    sme_id: "sasha",
    status: "watching",
    status_label: "Now watching",
    current_finding: "Steel shipment 2d late · buffer covers 4 days",
    last_updated: NOW,
  },
  {
    sme_id: "mason",
    status: "recommending",
    status_label: "Recommending",
    current_finding: "Pull Pump 7 within 36hr · MTBF curve breached",
    last_updated: NOW,
  },
  {
    sme_id: "sage",
    status: "idle",
    status_label: "Idle",
    current_finding: "All audit checkpoints green · next at 16:00",
    last_updated: NOW,
  },
];

const PINNED: PinnedIncident = {
  id: "incident-line4-oee-1304",
  severity: "warning",
  headline: "Line 4 OEE dropped 12% in last 90 min",
  subtext: "IRIS + Mason converging · started 13:04",
  converging_sme_ids: ["iris", "mason"],
  started_at: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
};

export function getSnapshot(): SituationRoomSnapshot {
  return {
    shift_label: shiftLabelFor(new Date()),
    stations: STATIONS,
    pinned_incident: PINNED,
    fetched_at: new Date().toISOString(),
  };
}

export function getPersona(smeId: string): SMEPersona | undefined {
  return SME_ROSTER.find((p) => p.id === smeId);
}

function shiftLabelFor(d: Date): string {
  const h = d.getHours();
  if (h >= 6 && h < 14) return "DAY SHIFT";
  if (h >= 14 && h < 22) return "SWING SHIFT";
  return "NIGHT SHIFT";
}
