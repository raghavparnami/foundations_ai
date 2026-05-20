import { useEffect, useState } from "react";

type Insight = {
  id: number;
  view_slug: string;
  headline: string;
  body: string | null;
  importance: number;
  created_at: string;
};

const ROTATE_MS = 5_000;
const REFRESH_MS = 20_000;

export default function RunInsights() {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [i, setI] = useState(0);

  useEffect(() => {
    let alive = true;
    async function fetchAll() {
      try {
        const r = await fetch("/api/insights");
        const j = await r.json();
        if (!alive) return;
        setInsights(j.insights ?? []);
      } catch {
        /* swallow */
      }
    }
    void fetchAll();
    const iv = setInterval(fetchAll, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  useEffect(() => {
    if (insights.length <= 1) return;
    const iv = setInterval(() => setI((x) => (x + 1) % insights.length), ROTATE_MS);
    return () => clearInterval(iv);
  }, [insights.length]);

  if (insights.length === 0) return null;
  const item = insights[i] ?? insights[0]!;
  const accent =
    item.importance >= 5 ? "#dc2626" : item.importance >= 4 ? "#b45309" : "var(--accent)";

  return (
    <div className="flex items-center gap-3">
      <div className="hidden sm:flex flex-col items-end">
        <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold">
          Insight
        </div>
      </div>
      <a
        href="/admin"
        className="group relative inline-flex items-center gap-3 max-w-[460px] rounded-full border border-[var(--border)] bg-[var(--bg-elev)] px-3 py-1.5 hover:border-[var(--accent)] hover:shadow-sm transition"
        title={item.body ?? item.headline}
      >
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: accent,
            flexShrink: 0,
          }}
        />
        <span className="flex flex-col leading-tight min-w-0">
          <span className="text-[12px] font-medium text-[var(--text)] truncate">
            {item.headline}
          </span>
          <span className="text-[10px] text-[var(--text-muted)] truncate font-mono">
            loom_views.{item.view_slug}
          </span>
        </span>
        {insights.length > 1 && (
          <span className="text-[10px] text-[var(--text-faint)] font-mono shrink-0">
            {i + 1}/{insights.length}
          </span>
        )}
      </a>
    </div>
  );
}
