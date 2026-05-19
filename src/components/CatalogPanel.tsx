"use client";
import { useEffect, useState } from "react";
import DocView from "./DocView";

type TableState = {
  id: number;
  schema: string;
  name: string;
  row_count: number;
  column_count: number;
  status: "pending" | "profiling" | "profiled" | "enriching" | "ready";
  profiled_at: string | null;
  enriched_at: string | null;
  source: string;
};

type AuditEntry = {
  id: number;
  ts: string;
  actor: string;
  action: string;
  target: string | null;
};

const STATUS_COLOR: Record<TableState["status"], string> = {
  pending: "#9ca3af",
  profiling: "#b45309",
  profiled: "#2563eb",
  enriching: "#7c3aed",
  ready: "#059669",
};

export default function CatalogPanel() {
  const [tables, setTables] = useState<TableState[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [openTableId, setOpenTableId] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const [c, a] = await Promise.all([
          fetch("/api/catalog").then((r) => r.json()),
          fetch("/api/audit").then((r) => r.json()),
        ]);
        if (!alive) return;
        setTables(c.tables ?? []);
        setAudit(a.entries ?? []);
      } catch {
        // swallow
      }
    }
    void tick();
    const iv = setInterval(tick, 1200);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  if (openTableId) {
    return <DocView tableId={openTableId} onClose={() => setOpenTableId(null)} />;
  }

  const readyCount = tables.filter((t) => t.status === "ready").length;

  return (
    <div className="flex flex-col h-full bg-[var(--bg-soft)]">
      <div className="px-5 py-3 border-b border-[var(--border)] flex items-center justify-between bg-[var(--bg-elev)]">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text)]">Always preparing</h2>
          <p className="text-[11px] text-[var(--text-faint)] -mt-0.5">
            {tables.length === 0
              ? "waiting on first profile…"
              : `${readyCount} of ${tables.length} tables ready`}
          </p>
        </div>
        <span className="inline-block w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse" />
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {tables.length === 0 && (
          <div className="text-[12px] text-[var(--text-muted)] px-2 py-6 text-center border border-dashed border-[var(--border)] rounded">
            Loom is connecting to <code>factory_demo</code> and indexing tables…
          </div>
        )}
        {tables.map((t) => (
          <button
            key={t.id}
            onClick={() => setOpenTableId(t.id)}
            className="w-full text-left rounded-md border border-[var(--border)] bg-[var(--bg-elev)] hover:border-[var(--accent)] hover:shadow-sm transition px-3 py-2"
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

      <div className="border-t border-[var(--border)] p-4 bg-[var(--bg-elev)]">
        <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] mb-2 font-semibold">
          Activity
        </div>
        <ul className="space-y-1 max-h-44 overflow-y-auto">
          {audit.slice(0, 30).map((e) => (
            <li key={e.id} className="text-[11px] text-[var(--text-muted)] font-mono">
              <span className="text-[var(--text-faint)]">
                {new Date(e.ts).toLocaleTimeString([], { hour12: false })}
              </span>{" "}
              <span style={{ color: actorColor(e.actor) }}>{e.actor}</span>{" "}
              <span className="text-[var(--text)]">{e.action}</span>
              {e.target ? <span className="text-[var(--text-faint)]"> · {e.target}</span> : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function actorColor(actor: string): string {
  if (actor.startsWith("worker")) return "#7c3aed";
  if (actor === "agent") return "#059669";
  if (actor === "user") return "#b45309";
  return "#2563eb";
}
