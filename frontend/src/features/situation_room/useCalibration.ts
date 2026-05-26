/**
 * Loads calibration scores for every SME and refreshes on demand.
 * Used by SMEStation cards to surface "84% over 47 cases" next to the
 * persona name.
 */
import { useEffect, useState } from "react";
import { getAllCalibration, type Calibration } from "./ledger";

const POLL_MS = 60_000;

export function useCalibration(): Record<string, Calibration> {
  const [data, setData] = useState<Record<string, Calibration>>({});
  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const m = await getAllCalibration();
        if (alive) setData(m);
      } catch {
        // ignore
      }
    }
    void tick();
    const iv = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);
  return data;
}
