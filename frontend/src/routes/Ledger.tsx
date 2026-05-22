/**
 * Decisions Ledger — list view of every Standing Meeting ever convened.
 *
 * Read-only history. Each row: time, kind, panel, question, outcome, slug.
 * Click → drawer with the receipts (per-SME answer text + the synthesis
 * consensus). The ledger is the system of record for "what did ops decide
 * this shift".
 */
import { useEffect, useMemo, useState } from "react";
import { listDecisions, type Decision } from "../features/situation_room/ledger";
import { getPersona } from "../features/situation_room/fixtures";

const KIND_LABEL: Record<Decision["kind"], string> = {
  "ad-hoc": "Ad-hoc",
  briefing: "Briefing",
  sme: "Brief from SME",
};

export default function Ledger() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [outcomeFilter, setOutcomeFilter] = useState<string>("all");

  async function refresh() {
    setLoading(true);
    try {
      setDecisions(await listDecisions());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const iv = setInterval(refresh, 30_000);
    return () => clearInterval(iv);
  }, []);

  const filtered = useMemo(() => {
    return outcomeFilter === "all"
      ? decisions
      : decisions.filter((d) => d.outcome === outcomeFilter);
  }, [decisions, outcomeFilter]);

  const selected = useMemo(
    () => decisions.find((d) => d.slug === selectedSlug) ?? null,
    [decisions, selectedSlug],
  );

  return (
    <main className="flex flex-col flex-1 min-h-0 bg-[var(--bg)]">
      <header className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[15px] font-semibold text-[var(--text)]">
            Decisions Ledger
          </h1>
          <p className="text-[11.5px] text-[var(--text-muted)] mt-0.5">
            Every Standing Meeting, every outcome. Auditable.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11.5px]">
          <label className="text-[var(--text-muted)]">Outcome</label>
          <select
            value={outcomeFilter}
            onChange={(e) => setOutcomeFilter(e.target.value)}
            className="bg-[var(--bg-elev)] text-[var(--text)] outline-none rounded-md px-2 py-1"
            style={{ border: "0.5px solid var(--border)" }}
          >
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="accepted">Accepted</option>
            <option value="overridden">Overridden</option>
          </select>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
          {loading && decisions.length === 0 && (
            <div className="text-[12px] text-[var(--text-faint)] italic">
              loading…
            </div>
          )}
          {error && (
            <div className="text-[12px] text-red-500">{error}</div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="text-[12.5px] text-[var(--text-faint)] italic">
              No meetings yet. Convene one from the Situation Room.
            </div>
          )}
          <ul className="space-y-2">
            {filtered.map((d) => (
              <li key={d.slug}>
                <button
                  type="button"
                  onClick={() => setSelectedSlug(d.slug)}
                  className={
                    "w-full text-left rounded-md p-3 transition " +
                    (d.slug === selectedSlug
                      ? "bg-[var(--bg-elev)] shadow-sm"
                      : "bg-[var(--bg-elev)] hover:bg-[var(--bg-soft)]")
                  }
                  style={{
                    border: "0.5px solid var(--color-border-tertiary)",
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[10.5px] uppercase tracking-wider font-medium text-[var(--text-faint)]">
                        {KIND_LABEL[d.kind]}
                      </span>
                      <span className="text-[11px] text-[var(--text-faint)] font-mono shrink-0">
                        {d.slug}
                      </span>
                      <OutcomeBadge outcome={d.outcome} />
                    </div>
                    <span className="text-[10.5px] text-[var(--text-faint)]">
                      {formatTime(d.opened_at)}
                    </span>
                  </div>
                  <div className="mt-1 text-[13px] text-[var(--text)] truncate">
                    {d.question}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1">
                    {d.panel.map((sid) => {
                      const p = getPersona(sid);
                      const name = p?.name ?? sid;
                      const bg = p?.color.bg ?? "var(--bg-soft)";
                      const fg = p?.color.fg ?? "var(--text-muted)";
                      return (
                        <span
                          key={sid}
                          className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                          style={{ background: bg, color: fg }}
                        >
                          {name}
                        </span>
                      );
                    })}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {selected && (
          <aside
            className="hidden lg:flex w-[420px] shrink-0 flex-col overflow-y-auto"
            style={{
              borderLeft: "0.5px solid var(--color-border-tertiary)",
              background: "var(--bg-soft)",
            }}
          >
            <DecisionDetail decision={selected} onClose={() => setSelectedSlug(null)} />
          </aside>
        )}
      </div>
    </main>
  );
}

function OutcomeBadge({ outcome }: { outcome: Decision["outcome"] }) {
  const palette: Record<Decision["outcome"], { bg: string; fg: string }> = {
    open: { bg: "#FAEEDA", fg: "#BA7517" },
    closed: { bg: "var(--bg-soft)", fg: "var(--text-muted)" },
    accepted: { bg: "#E1F5EE", fg: "#0F6E56" },
    overridden: { bg: "#FBE5E1", fg: "#B33A21" },
  };
  const p = palette[outcome];
  return (
    <span
      className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded"
      style={{ background: p.bg, color: p.fg }}
    >
      {outcome}
    </span>
  );
}

function DecisionDetail({ decision, onClose }: { decision: Decision; onClose: () => void }) {
  const receipts = (decision.receipts ?? {}) as Record<string, unknown>;
  const synthRaw = receipts["_synthesis"];
  const synth =
    synthRaw && typeof synthRaw === "object"
      ? (synthRaw as { consensus_summary?: string; dissenters?: { sme_id: string; reason: string }[] })
      : null;
  const perSme = Object.entries(receipts).filter(([k]) => !k.startsWith("_"));

  return (
    <div className="p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] uppercase tracking-wider text-[var(--text-faint)] font-medium">
            {KIND_LABEL[decision.kind]} · <span className="font-mono normal-case">{decision.slug}</span>
          </div>
          <h2 className="mt-1 text-[14px] font-medium text-[var(--text)] leading-snug">
            {decision.question}
          </h2>
          <div className="mt-1 text-[11px] text-[var(--text-muted)]">
            Opened {formatTime(decision.opened_at)}
            {decision.closed_at && ` · Closed ${formatTime(decision.closed_at)}`}
            {decision.context_label && ` · ${decision.context_label}`}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[11.5px] text-[var(--text-muted)] hover:text-[var(--text)] px-2 py-1"
        >
          Close
        </button>
      </div>

      <OutcomeBadge outcome={decision.outcome} />

      {synth && (
        <div
          className="rounded-md p-3"
          style={{
            background: "var(--bg-elev)",
            border: "0.5px solid var(--color-border-tertiary)",
          }}
        >
          <div className="text-[10px] uppercase tracking-wider font-medium text-[var(--text-faint)] mb-1">
            Consensus
          </div>
          <div className="text-[12.5px] text-[var(--text)]">
            {synth.consensus_summary || "—"}
          </div>
          {synth.dissenters && synth.dissenters.length > 0 && (
            <ul className="mt-2 space-y-1">
              {synth.dissenters.map((d) => {
                const p = getPersona(d.sme_id);
                return (
                  <li key={d.sme_id} className="text-[11.5px]">
                    <span
                      className="px-1 py-0.5 rounded mr-1.5 text-[10px] font-medium"
                      style={{
                        background: p?.color.bg ?? "var(--bg-soft)",
                        color: p?.color.fg ?? "var(--text-muted)",
                      }}
                    >
                      {p?.name ?? d.sme_id}
                    </span>
                    <span className="text-[var(--text)]">dissents: {d.reason}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <div className="space-y-2">
        {perSme.length === 0 && (
          <div className="text-[11.5px] text-[var(--text-faint)] italic">
            No per-SME receipts captured (meeting closed before columns finished).
          </div>
        )}
        {perSme.map(([sid, payload]) => {
          const p = getPersona(sid);
          const text =
            typeof payload === "object" && payload && "text" in (payload as Record<string, unknown>)
              ? String((payload as Record<string, unknown>)["text"] ?? "")
              : "";
          return (
            <div
              key={sid}
              className="rounded-md p-3"
              style={{
                background: "var(--bg-elev)",
                border: "0.5px solid var(--color-border-tertiary)",
              }}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className="text-[10.5px] font-medium px-1.5 py-0.5 rounded"
                  style={{
                    background: p?.color.bg ?? "var(--bg-soft)",
                    color: p?.color.fg ?? "var(--text-muted)",
                  }}
                >
                  {p?.name ?? sid}
                </span>
                {p && (
                  <span className="text-[10.5px] text-[var(--text-muted)]">
                    {p.role}
                  </span>
                )}
              </div>
              <div className="text-[12.5px] text-[var(--text)] whitespace-pre-wrap">
                {text || "—"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
