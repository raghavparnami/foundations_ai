/**
 * Spend — visible breakdown of how much LLM money this platform has burned
 * this shift. Per-SME, per-call-type, per-model.
 *
 * Numbers are in-memory and reset on backend restart ("this shift"). For
 * a longer-horizon picture we'd persist cost rows; today the focus is
 * "how much did this conversation / today / right now cost?".
 */
import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { getPersona } from "../features/situation_room/fixtures";
import {
  formatUsd,
  type CostMeter,
} from "../features/situation_room/useCostMeter";

const KIND_LABEL: Record<string, string> = {
  "sme-deliberate": "SME deliberate (panel)",
  "sme-synthesize": "SME synthesis (consensus)",
  "sme-distill": "SME knowledge distill",
  "chat-agent-round": "Chat agent · tool rounds",
  "chat-agent-final": "Chat agent · final answer",
  "chat-agent-fallback": "Chat agent · fallback",
};

const POLL_MS = 10_000;

export default function Spend() {
  const [meter, setMeter] = useState<CostMeter | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  async function refresh() {
    try {
      const m = await api.get<CostMeter>("/api/llm/cost-meter");
      setMeter(m);
      setError(null);
    } catch (e) {
      if (!(e instanceof ApiError)) setError((e as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
    const iv = setInterval(refresh, POLL_MS);
    return () => clearInterval(iv);
  }, []);

  async function resetShift() {
    if (!confirm("Reset the cost meter? This clears the running totals.")) return;
    setResetting(true);
    try {
      await api.post("/api/llm/cost-meter/reset", {});
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setResetting(false);
    }
  }

  if (!meter) {
    return (
      <main className="flex flex-col flex-1 min-h-0 bg-[var(--bg)] p-6">
        <div className="text-[12px] text-[var(--text-faint)] italic">loading…</div>
      </main>
    );
  }

  const since = new Date(meter.started_at);
  const sinceLabel = since.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const totalTokens = meter.total.prompt_tokens + meter.total.completion_tokens;

  const smeRows = Object.entries(meter.by_sme).sort(
    (a, b) => b[1].cost_usd - a[1].cost_usd,
  );
  const kindRows = Object.entries(meter.by_kind).sort(
    (a, b) => b[1].cost_usd - a[1].cost_usd,
  );
  const modelRows = Object.entries(meter.by_model).sort(
    (a, b) => b[1].cost_usd - a[1].cost_usd,
  );

  const maxSme = Math.max(...smeRows.map(([, b]) => b.cost_usd), 0.0001);
  const maxKind = Math.max(...kindRows.map(([, b]) => b.cost_usd), 0.0001);

  return (
    <main className="flex flex-col flex-1 min-h-0 bg-[var(--bg)] overflow-y-auto">
      <header className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[15px] font-semibold text-[var(--text)]">
            Platform spend
          </h1>
          <p className="text-[11.5px] text-[var(--text-muted)] mt-0.5">
            Running totals since {sinceLabel} · in-memory · resets on backend restart
          </p>
        </div>
        <button
          type="button"
          onClick={() => void resetShift()}
          disabled={resetting}
          className="text-[12px] font-medium px-3 py-1.5 rounded-full bg-[var(--bg-elev)] text-[var(--text-muted)] hover:text-[var(--text)] transition"
          style={{ border: "0.5px solid var(--color-border-tertiary)" }}
        >
          {resetting ? "Resetting…" : "Reset shift"}
        </button>
      </header>

      {error && (
        <div className="px-6 pt-4 text-[12px] text-red-500">{error}</div>
      )}

      <section className="px-6 py-5 grid gap-4 md:grid-cols-3">
        <BigStat
          label="Total spend"
          value={formatUsd(meter.total.cost_usd)}
          sub={`${meter.total.calls.toLocaleString()} LLM call${meter.total.calls === 1 ? "" : "s"}`}
          accent="#5b6cff"
        />
        <BigStat
          label="Tokens"
          value={totalTokens.toLocaleString()}
          sub={`${meter.total.prompt_tokens.toLocaleString()} in · ${meter.total.completion_tokens.toLocaleString()} out`}
          accent="#0F6E56"
        />
        <BigStat
          label="Avg cost / call"
          value={
            meter.total.calls > 0
              ? formatUsd(meter.total.cost_usd / meter.total.calls)
              : "$0.00"
          }
          sub="estimate · 4 chars per token"
          accent="#993C1D"
        />
      </section>

      <section className="px-6 pb-6 grid gap-4 lg:grid-cols-2">
        <Panel title="Spend by SME" empty={smeRows.length === 0 ? "No SME calls yet." : null}>
          {smeRows.map(([sid, b]) => {
            const p = getPersona(sid);
            const pct = (b.cost_usd / maxSme) * 100;
            return (
              <Row
                key={sid}
                color={p?.color.fg ?? "#5b6cff"}
                background={p?.color.bg ?? "var(--bg-soft)"}
                pct={pct}
                label={p?.name ?? sid}
                sub={p?.role ?? "custom SME"}
                value={formatUsd(b.cost_usd)}
                detail={`${b.calls} call${b.calls === 1 ? "" : "s"} · ${b.tokens.toLocaleString()} tok`}
              />
            );
          })}
        </Panel>

        <Panel title="Spend by call type" empty={kindRows.length === 0 ? "No calls recorded." : null}>
          {kindRows.map(([k, b]) => {
            const pct = (b.cost_usd / maxKind) * 100;
            return (
              <Row
                key={k}
                color="#5b6cff"
                background="var(--bg-soft)"
                pct={pct}
                label={KIND_LABEL[k] ?? k}
                sub={k}
                value={formatUsd(b.cost_usd)}
                detail={`${b.calls} call${b.calls === 1 ? "" : "s"} · ${b.tokens.toLocaleString()} tok`}
              />
            );
          })}
        </Panel>
      </section>

      <section className="px-6 pb-6">
        <Panel title="Spend by model" empty={modelRows.length === 0 ? "No calls recorded." : null}>
          {modelRows.map(([m, b]) => (
            <Row
              key={m}
              color="#534AB7"
              background="var(--bg-soft)"
              pct={meter.total.cost_usd > 0 ? (b.cost_usd / meter.total.cost_usd) * 100 : 0}
              label={m}
              sub="share of total"
              value={formatUsd(b.cost_usd)}
              detail={`${b.calls} call${b.calls === 1 ? "" : "s"} · ${b.tokens.toLocaleString()} tok`}
            />
          ))}
        </Panel>
      </section>
    </main>
  );
}

function BigStat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent: string;
}) {
  return (
    <div
      className="rounded-xl p-5 bg-[var(--color-background-primary)]"
      style={{ border: "0.5px solid var(--color-border-tertiary)" }}
    >
      <div className="text-[10.5px] uppercase tracking-wider font-medium text-[var(--text-muted)]">
        {label}
      </div>
      <div
        className="text-[24px] font-semibold leading-none mt-2"
        style={{ color: accent }}
      >
        {value}
      </div>
      <div className="text-[11.5px] text-[var(--text-faint)] mt-1.5">{sub}</div>
    </div>
  );
}

function Panel({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string | null;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl p-4 bg-[var(--color-background-primary)] flex flex-col gap-2"
      style={{ border: "0.5px solid var(--color-border-tertiary)" }}
    >
      <h2 className="text-[12.5px] font-semibold text-[var(--text)]">{title}</h2>
      {empty ? (
        <div className="text-[11.5px] text-[var(--text-faint)] italic">{empty}</div>
      ) : (
        <ul className="space-y-1.5">{children}</ul>
      )}
    </div>
  );
}

function Row({
  color,
  background,
  pct,
  label,
  sub,
  value,
  detail,
}: {
  color: string;
  background: string;
  pct: number;
  label: string;
  sub: string;
  value: string;
  detail: string;
}) {
  return (
    <li className="relative px-3 py-2 rounded-md overflow-hidden" style={{ background }}>
      <div
        aria-hidden
        className="absolute inset-y-0 left-0 transition-all"
        style={{
          width: `${Math.max(2, Math.min(100, pct))}%`,
          background: color,
          opacity: 0.18,
        }}
      />
      <div className="relative flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-medium text-[var(--text)] truncate">
            {label}
          </div>
          <div className="text-[10.5px] text-[var(--text-muted)] truncate font-mono">
            {sub}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[13px] font-semibold" style={{ color }}>
            {value}
          </div>
          <div className="text-[10.5px] text-[var(--text-faint)]">{detail}</div>
        </div>
      </div>
    </li>
  );
}
