/**
 * Polls /api/llm/cost-meter every 20s. Returns the running totals so the
 * status strip can show a tiny "$0.14 · 12 calls" pill.
 */
import { useEffect, useState } from "react";
import { api, ApiError } from "../../lib/api";

export type CostMeter = {
  started_at: string;
  total: {
    calls: number;
    prompt_tokens: number;
    completion_tokens: number;
    cost_usd: number;
  };
  by_kind: Record<string, { calls: number; tokens: number; cost_usd: number }>;
  by_model: Record<string, { calls: number; tokens: number; cost_usd: number }>;
};

const POLL_MS = 20_000;

export function useCostMeter(): CostMeter | null {
  const [meter, setMeter] = useState<CostMeter | null>(null);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const m = await api.get<CostMeter>("/api/llm/cost-meter");
        if (alive) setMeter(m);
      } catch (e) {
        if (e instanceof ApiError) return;
      }
    }
    void tick();
    const iv = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  return meter;
}

export function formatUsd(v: number): string {
  if (v === 0) return "$0.00";
  if (v < 0.01) return "<$0.01";
  if (v < 10) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(0)}`;
}
