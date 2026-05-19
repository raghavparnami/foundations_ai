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

type Proposal = {
  id: number;
  kind: string;
  name: string;
  description: string | null;
  sql: string;
  status: string;
  created_at: string;
};

const STATUS_COLOR: Record<TableState["status"], string> = {
  pending: "#9ca3af",
  profiling: "#b45309",
  profiled: "#2563eb",
  enriching: "#7c3aed",
  ready: "#059669",
};

export default function AdminCatalog() {
  const [tables, setTables] = useState<TableState[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [openTableId, setOpenTableId] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const [c, a, p] = await Promise.all([
          fetch("/api/catalog").then((r) => r.json()),
          fetch("/api/audit").then((r) => r.json()),
          fetch("/api/proposals").then((r) => r.json()),
        ]);
        if (!alive) return;
        setTables(c.tables ?? []);
        setAudit(a.entries ?? []);
        setProposals(p.proposals ?? []);
      } catch {
        // swallow
      }
    }
    void tick();
    const iv = setInterval(tick, 1500);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  if (openTableId) {
    return (
      <div className="h-full">
        <DocView tableId={openTableId} onClose={() => setOpenTableId(null)} />
      </div>
    );
  }

  const readyCount = tables.filter((t) => t.status === "ready").length;

  return (
    <div className="h-full overflow-y-auto bg-[var(--bg)]">
      <div className="max-w-[1100px] mx-auto p-6 space-y-6">
        <SectionHeader title="Tables" subtitle={`${readyCount} of ${tables.length} ready`} />
        <div className="grid grid-cols-2 gap-3">
          {tables.length === 0 && (
            <div className="col-span-2 text-[12px] text-[var(--text-muted)] px-2 py-6 text-center border border-dashed border-[var(--border)] rounded">
              No tables yet — Loom is connecting…
            </div>
          )}
          {tables.map((t) => (
            <button
              key={t.id}
              onClick={() => setOpenTableId(t.id)}
              className="text-left rounded-lg border border-[var(--border)] bg-[var(--bg-elev)] hover:border-[var(--accent)] hover:shadow-sm transition px-4 py-3"
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-[var(--text)]">{t.name}</span>
                  <span className="text-[11px] text-[var(--text-faint)] ml-2">{t.schema}</span>
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

        <SectionHeader title="Saved views" subtitle={`${proposals.length} proposal${proposals.length === 1 ? "" : "s"}`} />
        <div className="space-y-2">
          {proposals.length === 0 && (
            <div className="text-[12px] text-[var(--text-muted)] px-2 py-6 text-center border border-dashed border-[var(--border)] rounded">
              No views yet. Ask the agent a question — it'll save the result as a view.
            </div>
          )}
          {proposals.map((p) => (
            <ProposalRow key={p.id} p={p} onChange={() => {
              // soft refresh
              fetch("/api/proposals").then((r) => r.json()).then((j) => setProposals(j.proposals ?? []));
            }} />
          ))}
        </div>

        <SectionHeader title="Activity" subtitle="latest 30 events" />
        <ul className="space-y-0.5 bg-[var(--bg-elev)] rounded-lg border border-[var(--border)] p-3">
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

function ProposalRow({ p, onChange }: { p: Proposal; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [sql, setSql] = useState(p.sql);
  const [desc, setDesc] = useState(p.description ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/views/${p.name}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql, description: desc }),
      });
      if (!r.ok) {
        const j = await r.json();
        setErr(j.error ?? "save failed");
        return;
      }
      setEditing(false);
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Drop view loom_views.${p.name}? This deletes it from Postgres.`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/views/${p.name}`, { method: "DELETE" });
      if (!r.ok) {
        const j = await r.json();
        setErr(j.error ?? "delete failed");
        return;
      }
      onChange();
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="rounded-lg border border-[var(--accent)] bg-[var(--bg-elev)] px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <code className="text-[var(--accent)] text-[13px]">loom_views.{p.name}</code>
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">editing</span>
        </div>
        <input
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="One-line description"
          className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1 text-[12px] outline-none focus:border-[var(--accent)]"
        />
        <textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          rows={8}
          className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1 text-[11px] font-mono outline-none focus:border-[var(--accent)]"
        />
        {err && <div className="text-[11px] text-red-600">{err}</div>}
        <div className="flex items-center gap-2">
          <button
            disabled={busy}
            onClick={save}
            className="bg-[var(--accent)] text-white text-[12px] font-medium px-3 py-1.5 rounded-md disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save"}
          </button>
          <button
            onClick={() => { setEditing(false); setSql(p.sql); setDesc(p.description ?? ""); setErr(null); }}
            className="text-[12px] text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <details className="rounded-lg border border-[var(--border)] bg-[var(--bg-elev)] px-4 py-2">
      <summary className="cursor-pointer text-sm flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <code className="text-[var(--accent)]">loom_views.{p.name}</code>
          <span className="text-[11px] text-[var(--text-muted)] ml-2">{p.description ?? ""}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); setEditing(true); }}
            className="text-[11px] text-[var(--text-muted)] hover:text-[var(--accent)]"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); void remove(); }}
            className="text-[11px] text-red-600 hover:text-red-700"
          >
            Delete
          </button>
          <span className="text-[10px] text-[var(--text-faint)]">
            {new Date(p.created_at).toLocaleString()}
          </span>
        </div>
      </summary>
      <pre className="mt-2 text-[11px] text-[var(--text-muted)] overflow-x-auto bg-[var(--bg)] p-3 rounded border border-[var(--border)]">
        {p.sql}
      </pre>
    </details>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <h2 className="text-sm font-semibold text-[var(--text)]">{title}</h2>
      <span className="text-[11px] text-[var(--text-faint)]">{subtitle}</span>
    </div>
  );
}

function actorColor(actor: string): string {
  if (actor.startsWith("worker")) return "#7c3aed";
  if (actor === "agent") return "#059669";
  if (actor === "user") return "#b45309";
  return "#2563eb";
}
