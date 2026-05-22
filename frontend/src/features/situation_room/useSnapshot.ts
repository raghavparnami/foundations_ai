/**
 * Polls /api/situation-room/snapshot every 30s and exposes the resolved
 * snapshot. Falls back to the local fixture if the endpoint is unreachable
 * (dev without backend / migration period).
 *
 * Cost model: ~1 request/30s/client → backend hits 6 small SQL probes max
 * once/60s (server-side memo). No LLM. See backend/app/routes/situation_room.py.
 */
import { useEffect, useState } from "react";
import { api, ApiError } from "../../lib/api";
import { getSnapshot as fixtureSnapshot } from "./fixtures";
import type {
  PinnedIncident,
  SituationRoomSnapshot,
  SMEStation,
} from "./types";

const POLL_MS = 30_000;

type ApiResponse = {
  shift_label: string;
  stations: SMEStation[];
  pinned_incident: PinnedIncident | null;
  fetched_at: string;
  source: string;
};

export function useSnapshot(): {
  snapshot: SituationRoomSnapshot;
  source: "live" | "fixture";
  lastError: string | null;
} {
  const [snapshot, setSnapshot] = useState<SituationRoomSnapshot>(() =>
    fixtureSnapshot(),
  );
  const [source, setSource] = useState<"live" | "fixture">("fixture");
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const j = await api.get<ApiResponse>("/api/situation-room/snapshot");
        if (!alive) return;
        setSnapshot({
          shift_label: j.shift_label,
          stations: j.stations,
          pinned_incident: j.pinned_incident,
          fetched_at: j.fetched_at,
        });
        setSource("live");
        setLastError(null);
      } catch (e) {
        if (!alive) return;
        const msg = e instanceof ApiError ? `HTTP ${e.status}` : (e as Error).message;
        setLastError(msg);
        // Keep showing the fixture so the UI doesn't go blank.
      }
    }
    void tick();
    const iv = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  return { snapshot, source, lastError };
}
