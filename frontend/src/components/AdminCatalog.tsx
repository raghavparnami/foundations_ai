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

type CatalogResponse = { tables?: TableState[] };
type AuditResponse = { entries?: AuditEntry[] };

const STATUS_COLOR: Record<TableStatus, string> = {
  pending: "#9ca3af",
  profiling: "#b45309",
  profiled: "#2563eb",
  enriching: "#7c3aed",
  ready: "#10b981",
};

/**
 * Full catalog table view used by the Admin page. Lists tables, audit log,
 * and lets the user drill into a single table's generated doc.
 */
export default function AdminCatalog() {
  const [tables, setTables] = useState<TableState[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [openTableId, setOpenTableId] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const [c, a] = await Promise.all([
          api.get<CatalogResponse>("/api/catalog/"),
          api.get<AuditResponse>("/api/catalog/audit"),
        ]);
        if (!alive) return;
        setTables(c.tables ?? []);
        setAudit(a.entries ?? []);
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
    return (
      <div className="h-full">
        <DocView tableId={openTableId} onClose={() => setOpenTableId(null)} />
      </div>
    );
  }

  const readyCount = tables.filter((t) => t.status === "ready").length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[1100px] mx-auto p-6 space-y-6">
        <SectionHeader
          title="Tables"
          subtitle={`${readyCount} of ${tables.length} ready`}
        />
        <div className="grid grid-cols-2 gap-3">
          {tables.length === 0 && (
            <div className="col-span-2 text-[12px] text-[var(--text-muted)] px-2 py-6 text-center border border-dashed border-[var(--border)] rounded">
              No tables yet — Loom is connecting…
            </div>
          )}
          {tables.map((t) => (
            <button
              type="button"
              key={t.id}
              onClick={() => setOpenTableId(t.id)}
              className="text-left rounded-lg border border-[var(--border)] bg-[var(--bg-soft)] hover:bg-[var(--bg-elev)] transition px-4 py-3"
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-[var(--text)]">
                    {t.name}
                  </span>
                  <span className="text-[11px] text-[var(--text-faint)] ml-2">
                    {t.schema}
                  </span>
                </div>
                <span
                  className="text-[10px] uppercase tracking-wider font-semibold"
                  style={{ color: STATUS_COLOR[t.status] }}
                >
                  {t.status}
                </span>
              </div>
              <div className="text-[11px] text-[var(--text-muted)] mt-1">
                {t.row_count.toLocaleString()} rows · {t.column_count} cols
              </div>
            </button>
          ))}
        </div>

        <SectionHeader title="Activity" subtitle="latest 30 events" />
        <ul className="space-y-0.5 bg-[var(--bg-soft)] rounded-lg border border-[var(--border)] p-3">
          {audit.length === 0 && (
            <li className="text-[11px] text-[var(--text-faint)] font-mono">
              no events yet
            </li>
          )}
          {audit.slice(0, 30).map((e) => (
            <li
              key={e.id}
              className="text-[11px] text-[var(--text-muted)] font-mono"
            >
              <span className="text-[var(--text-faint)]">
                {new Date(e.ts).toLocaleTimeString([], { hour12: false })}
              </span>{" "}
              <span style={{ color: actorColor(e.actor) }}>{e.actor}</span>{" "}
              <span className="text-[var(--text)]">{e.action}</span>
              {e.target ? (
                <span className="text-[var(--text-faint)]"> · {e.target}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <h2 className="text-sm font-semibold text-[var(--text)]">{title}</h2>
      <span className="text-[11px] text-[var(--text-faint)]">{subtitle}</span>
    </div>
  );
}

function actorColor(actor: string): string {
  if (actor.startsWith("worker")) return "#a855f7";
  if (actor === "agent") return "#10b981";
  if (actor === "user") return "#b45309";
  return "#3b82f6";
}
