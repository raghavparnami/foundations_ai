import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Insight = {
  id: number;
  view_slug: string;
  headline: string;
  body: string | null;
  importance: number;
  created_at: string;
};

type InsightsResponse = {
  insights?: Insight[];
};

/**
 * Top-6 insights by importance, refreshing every 6s. Each card shows the
 * headline + optional body and a faint view-slug footer.
 */
export default function InsightsPanel() {
  const [items, setItems] = useState<Insight[]>([]);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const j = await api.get<InsightsResponse>("/api/insights");
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

  const top = [...items]
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 6);

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
      </div>
      <div className="px-3 pb-3 max-h-[300px] overflow-y-auto">
        {top.length === 0 ? (
          <div className="text-[11px] text-[var(--text-faint)] px-2 py-4 text-center border border-dashed border-[var(--border)] rounded-lg">
            No insights yet. Loom will surface findings once it has saved a
            view to analyze.
          </div>
        ) : (
          <ul className="space-y-1.5">
            {top.map((it) => (
              <InsightCard key={it.id} it={it} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function InsightCard({ it }: { it: Insight }) {
  const dot =
    it.importance >= 5 ? "#dc2626" : it.importance >= 4 ? "#b45309" : "#a78bfa";
  return (
    <li className="rounded-lg p-2.5 text-[11px] bg-[var(--bg-soft)] border border-[var(--border)]">
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          style={{ background: dot }}
          className="mt-[5px] inline-block h-1.5 w-1.5 rounded-full flex-shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="font-medium leading-snug text-[var(--text)]">
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
