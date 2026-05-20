import { useEffect, useState } from "react";
import { api } from "../lib/api";
import DocView from "./DocView";

type TableStatus = "pending" | "profiling" | "profiled" | "enriching" | "ready";

type TableState = {
  id: number;
  schema: string;
  name: string;
  row_count: number;
  column_count: number;
  status: TableStatus;
  source: string;
};

type CatalogResponse = { tables?: TableState[] };

const STATUS_COLOR: Record<TableStatus, string> = {
  pending: "#9ca3af",
  profiling: "#b45309",
  profiled: "#2563eb",
  enriching: "#7c3aed",
  ready: "#10b981",
};

/**
 * Condensed catalog list — designed for sidebar use. Clicking a table opens
 * its generated doc inline.
 */
export default function CatalogPanel() {
  const [tables, setTables] = useState<TableState[]>([]);
  const [openTableId, setOpenTableId] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const j = await api.get<CatalogResponse>("/api/catalog/");
        if (!alive) return;
        setTables(j.tables ?? []);
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

  if (openTableId !== null) {
    return <DocView tableId={openTableId} onClose={() => setOpenTableId(null)} />;
  }

  const readyCount = tables.filter((t) => t.status === "ready").length;

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-3 border-b border-[var(--border)] flex items-center justify-between bg-[var(--bg-soft)]">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text)]">Always preparing</h2>
          <p className="text-[11px] text-[var(--text-faint)] -mt-0.5">
            {tables.length === 0
              ? "waiting on first profile…"
              : `${readyCount} of ${tables.length} tables ready`}
          </p>
        </div>
        <span
          aria-hidden
          className="inline-block w-2 h-2 rounded-full bg-white/40 animate-pulse"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {tables.length === 0 && (
          <div className="text-[12px] text-[var(--text-muted)] px-2 py-6 text-center border border-dashed border-[var(--border)] rounded">
            Loom is connecting and indexing tables…
          </div>
        )}
        {tables.map((t) => (
          <button
            type="button"
            key={t.id}
            onClick={() => setOpenTableId(t.id)}
            className="w-full text-left rounded-md border border-[var(--border)] bg-[var(--bg-soft)] hover:bg-[var(--bg-elev)] transition px-3 py-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-[var(--text)]">{t.name}</span>
              <span
                className="text-[10px] uppercase tracking-wider font-semibold"
                style={{ color: STATUS_COLOR[t.status] }}
              >
                {t.status}
              </span>
            </div>
            <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
              {t.row_count.toLocaleString()} rows · {t.column_count} cols
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
