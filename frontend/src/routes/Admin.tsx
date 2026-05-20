import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

type LLMInfo = { provider: string; model: string };
type Table = {
  id: number;
  schema: string;
  name: string;
  row_count: number;
  column_count: number;
  status: string;
  profiled_at: string | null;
  enriched_at: string | null;
  source: string;
};
type CatalogResp = { tables: Table[] };
type AuditEntry = {
  ts: string;
  actor: string;
  action: string;
  target: string | null;
  details: Record<string, unknown> | null;
};
type AuditResp = { entries: AuditEntry[] };

export default function Admin() {
  const llm = useQuery<LLMInfo>({
    queryKey: ["llm-info"],
    queryFn: () => api.get<LLMInfo>("/api/llm/info"),
    refetchInterval: 10_000,
  });
  const catalog = useQuery<CatalogResp>({
    queryKey: ["catalog"],
    queryFn: () => api.get<CatalogResp>("/api/catalog/"),
    refetchInterval: 4_000,
  });
  const audit = useQuery<AuditResp>({
    queryKey: ["audit"],
    queryFn: () => api.get<AuditResp>("/api/catalog/audit?limit=60"),
    refetchInterval: 4_000,
  });

  const tables = catalog.data?.tables ?? [];
  const byStatus: Record<string, number> = {};
  for (const t of tables) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;

  return (
    <div className="h-full overflow-auto p-8">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        Live operational view of Loom — LLM provider, catalog state, recent actions.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-soft)] p-5">
          <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
            LLM provider
          </h2>
          <div className="mt-2 font-mono text-sm">
            {llm.isLoading ? "loading…" : llm.data ? `${llm.data.provider} · ${llm.data.model}` : "unreachable"}
          </div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-soft)] p-5">
          <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
            Catalog
          </h2>
          <div className="mt-2 text-sm">
            <div>{tables.length} tables total</div>
            <div className="mt-1 text-[var(--text-muted)]">
              {Object.entries(byStatus)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([k, v]) => `${k}: ${v}`)
                .join(" · ") || "—"}
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-soft)] p-5">
          <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
            Activity
          </h2>
          <div className="mt-2 text-sm">{audit.data?.entries.length ?? 0} recent entries</div>
        </div>
      </div>

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-[var(--text-muted)]">
          Recent audit log
        </h2>
        <div className="overflow-auto rounded-lg border border-[var(--border)]">
          <table className="w-full text-xs">
            <thead className="bg-[var(--bg-soft)]">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Time</th>
                <th className="px-3 py-2 text-left font-medium">Actor</th>
                <th className="px-3 py-2 text-left font-medium">Action</th>
                <th className="px-3 py-2 text-left font-medium">Target</th>
                <th className="px-3 py-2 text-left font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {(audit.data?.entries ?? []).map((e, i) => (
                <tr key={i} className="border-t border-[var(--border)]">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[var(--text-muted)]">
                    {(e.ts || "").slice(11, 19)}
                  </td>
                  <td className="px-3 py-2 font-mono text-[var(--text-muted)]">{e.actor}</td>
                  <td className="px-3 py-2 font-mono text-emerald-600">{e.action}</td>
                  <td className="px-3 py-2 font-mono text-[var(--text-muted)]">{e.target || ""}</td>
                  <td className="max-w-md truncate px-3 py-2 font-mono text-[var(--text-faint)]">
                    {e.details ? JSON.stringify(e.details) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {audit.isLoading && (
            <div className="px-3 py-2 text-[var(--text-faint)]">loading…</div>
          )}
        </div>
      </section>
    </div>
  );
}
