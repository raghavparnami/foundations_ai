import { useEffect, useState } from "react";

type Snapshot = { ready: number; total: number };

export default function ReadinessPill() {
  const [s, setS] = useState<Snapshot>({ ready: 0, total: 0 });
  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const r = await fetch("/api/catalog/");
        const j = await r.json();
        if (!alive) return;
        const tables: { status: string }[] = j.tables ?? [];
        setS({
          ready: tables.filter((t) => t.status === "ready").length,
          total: tables.length,
        });
      } catch {
        /* swallow */
      }
    }
    void tick();
    const iv = setInterval(tick, 1500);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);
  const allReady = s.total > 0 && s.ready === s.total;
  const color = allReady ? "#059669" : s.total === 0 ? "#9ca3af" : "#7c3aed";
  return (
    <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
      <span
        className="inline-block w-2 h-2 rounded-full animate-pulse"
        style={{ background: color }}
      />
      {s.total === 0 ? "connecting…" : `${s.ready}/${s.total} tables ready`}
    </div>
  );
}
