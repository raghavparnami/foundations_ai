/**
 * Tiny client for the Decisions Ledger backend (/api/decisions).
 *
 * Used by StandingMeeting to log open / close events and by the Ledger
 * page to list past meetings. All calls go through the shared `api`
 * wrapper so they honour the runtime base URL resolution.
 */
import { api } from "../../lib/api";

export type Decision = {
  id: number;
  slug: string;
  kind: "ad-hoc" | "briefing" | "sme";
  question: string;
  panel: string[];
  context_label: string | null;
  pinned_id: string | null;
  outcome: "open" | "accepted" | "closed" | "overridden";
  accepted_sme: string | null;
  override_note: string | null;
  receipts: Record<string, unknown> | null;
  opened_at: string;
  closed_at: string | null;
};

export type OpenBody = {
  kind: Decision["kind"];
  question: string;
  panel: string[];
  context_label?: string | null;
  pinned_id?: string | null;
};

export type CloseBody = {
  outcome?: "closed" | "overridden";
  receipts?: Record<string, unknown>;
  override_note?: string | null;
};

export async function openDecision(body: OpenBody): Promise<Decision> {
  return api.post<Decision>("/api/decisions/open", body);
}

export async function closeDecision(
  slug: string,
  body: CloseBody = {},
): Promise<Decision> {
  return api.post<Decision>(`/api/decisions/${slug}/close`, body);
}

export async function listDecisions(): Promise<Decision[]> {
  const r = await api.get<{ decisions: Decision[] }>("/api/decisions");
  return r.decisions;
}

export type SynthResponse = {
  consensus_summary: string;
  dissenters: { sme_id: string; reason: string }[];
};

export async function synthesize(
  answers: { sme_id: string; text: string }[],
): Promise<SynthResponse> {
  return api.post<SynthResponse>("/api/sme/synthesize", { answers });
}

export type Calibration = {
  sme_id: string;
  total: number;
  up: number;
  down: number;
  accuracy: number | null;
};

export async function sendFeedback(
  sme_id: string,
  decision_slug: string,
  rating: 1 | -1,
): Promise<void> {
  await api.post("/api/sme/feedback", { sme_id, decision_slug, rating });
}

export async function getAllCalibration(): Promise<Record<string, Calibration>> {
  return api.get<Record<string, Calibration>>("/api/sme/calibration");
}
