"use client";
import { useEffect, useState } from "react";

type Insight = {
  id: number;
  view_slug: string;
  headline: string;
  body: string | null;
  importance: number;
  created_at: string;
};

/**
 * Lives in the upper-right of the chat layout. Shows the top findings the
 * insights worker has extracted from saved views — refreshes every 6s so the
 * panel reflects newly-created views without a page refresh.
 */
export default function InsightsPanel() {
  const [items, setItems] = useState<Insight[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const r = await fetch("/api/insights");
        const j = await r.json();
        if (!alive) return;
        setItems(j.insights ?? []);
      } catch {
        /* swallow */
      }
    }
    void tick();
    const iv = setInterval(tick, 6000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  async function refreshNow() {
    setRefreshing(true);
    try {
      await fetch("/api/insights/refresh", { method: "POST" });
      const r = await fetch("/api/insights");
      const j = await r.json();
      setItems(j.insights ?? []);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="border-b border-[var(--border)]">
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <div>
          <h3 className="text-[12px] font-semibold tracking-tight text-[var(--text)]">
            Insights
          </h3>
          <p className="text-[10px] text-[var(--text-faint)] -mt-0.5">
            from your saved views
          </p>
        </div>
        <button
          onClick={refreshNow}
          disabled={refreshing}
          title="Re-scan views for new insights"
          className="text-[10px] text-[var(--text-muted)] hover:text-[var(--accent)] disabled:opacity-40 transition px-1.5 py-0.5 rounded border border-[var(--border)] bg-[var(--bg-elev)]"
        >
          {refreshing ? "scanning…" : "refresh"}
        </button>
      </div>
      <div className="px-3 pb-3 max-h-[300px] overflow-y-auto">
        {items.length === 0 ? (
          <div className="text-[11px] text-[var(--text-faint)] px-2 py-4 text-center border border-dashed border-[var(--border)] rounded-lg">
            No insights yet. Loom will surface findings once it has saved a
            view to analyze.
          </div>
        ) : (
          <ul className="space-y-1.5">
            {items.slice(0, 6).map((it) => (
              <InsightCard key={it.id} it={it} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function InsightCard({ it }: { it: Insight }) {
  const tone =
    it.importance >= 5
      ? { bg: "#fff4f4", border: "#fecaca", dot: "#dc2626", text: "#7f1d1d" }
      : it.importance >= 4
        ? { bg: "#fff8eb", border: "#fde2b3", dot: "#b45309", text: "#7c2d12" }
        : { bg: "var(--accent-soft)", border: "#dbe0ff", dot: "var(--accent)", text: "var(--text)" };
  return (
    <li
      className="rounded-lg p-2.5 text-[11px]"
      style={{ background: tone.bg, border: `1px solid ${tone.border}` }}
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            marginTop: 5,
            borderRadius: 999,
            background: tone.dot,
            flexShrink: 0,
          }}
        />
        <div className="min-w-0 flex-1">
          <div className="font-medium leading-snug" style={{ color: tone.text }}>
            {it.headline}
          </div>
          {it.body && (
            <div className="text-[var(--text-muted)] mt-0.5 leading-snug">{it.body}</div>
          )}
          <div className="text-[9px] text-[var(--text-faint)] font-mono mt-1 truncate">
            {it.view_slug}
          </div>
        </div>
      </div>
    </li>
  );
}
