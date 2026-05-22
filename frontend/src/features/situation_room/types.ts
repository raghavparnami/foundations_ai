/**
 * Type contracts for the Situation Room (Phase 1).
 *
 * `SMEPersona` is the static identity of an SME (name, role, brand colors).
 * `SMEStation` is the live state surfaced for each persona (status + finding).
 * `PinnedIncident` is the optional incident card at the top.
 *
 * Phase 1 ships from a fixture; Phase 2+ will hydrate `SMEStation` and
 * `PinnedIncident` from a real backend endpoint that polls every ~30s.
 */
export type ISOTimestamp = string;

export type SMEIconName =
  | "settings-cog"
  | "broadcast"
  | "target"
  | "truck-delivery"
  | "tool"
  | "shield-check";

export type SMEStatus = "watching" | "alerting" | "recommending" | "idle";

export type SMEPersona = {
  id: string;
  name: string;
  role: string;
  icon: SMEIconName;
  /** Brand color pair driving the avatar pip and accent border. */
  color: { bg: string; fg: string };
  /** Routing hint — which question domains this SME should be convened for. */
  domain: string[];
  /** Constitutional powers (Phase 3); kept in the fixture but unused in Phase 1. */
  powers?: ("veto")[];
};

export type SMEStation = {
  sme_id: string;
  status: SMEStatus;
  /** Human-readable lead phrase ("Now watching", "Alerting", "Recommending"). */
  status_label: string;
  /** One-line current finding (max ~80 chars). */
  current_finding: string;
  last_updated: ISOTimestamp;
  /** 7 daily samples (oldest → newest), nullable when the probe doesn't
   *  produce a numeric series (e.g. Sasha has no source). */
  trail?: readonly number[] | null;
};

export type IncidentSeverity = "info" | "warning" | "critical";

export type PinnedIncident = {
  id: string;
  severity: IncidentSeverity;
  /** "Line 4 OEE dropped 12% in last 90 min" */
  headline: string;
  /** "IRIS + Mason converging · started 13:04" */
  subtext: string;
  converging_sme_ids: string[];
  started_at: ISOTimestamp;
};

/** Combined fixture/response shape — what a future GET /api/situation-room would return. */
export type SituationRoomSnapshot = {
  shift_label: string; // "DAY SHIFT" / "NIGHT SHIFT"
  stations: SMEStation[];
  pinned_incident: PinnedIncident | null;
  fetched_at: ISOTimestamp;
};
