"use client";
import { useEffect, useState } from "react";
import UploadForm from "@/components/wiki/UploadForm";
import ConnectForm from "@/components/wiki/ConnectForm";

type Source = {
  id: number;
  name: string;
  kind: string;
  conn_url: string;
  created_at: string;
  total_tables: number;
  ready_tables: number;
};

type TabKey = "databases" | "documents" | "repositories";

const TABS: { key: TabKey; label: string; sub: string }[] = [
  { key: "databases",    label: "Databases",    sub: "Postgres, Snowflake, Databricks" },
  { key: "documents",    label: "Documents",    sub: "PDF, DOCX, Markdown uploads" },
  { key: "repositories", label: "Repositories", sub: "GitLab projects" },
];

export default function ConnectionsPage() {
  const [tab, setTab] = useState<TabKey>("databases");

  return (
    <main className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      <header className="px-6 py-3 border-b border-[var(--border)] bg-[var(--bg-elev)]">
        <h1 className="text-sm font-semibold">Connections</h1>
        <p className="text-[11px] text-[var(--text-muted)] -mt-0.5">
          all the corpora Loom indexes — databases, documents, and code repositories
        </p>
      </header>

      <nav className="px-6 border-b border-[var(--border)] bg-[var(--bg-elev)] flex gap-1">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-[13px] border-b-2 transition ${
                active
                  ? "border-[var(--accent)] text-[var(--accent)] font-medium"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
              title={t.sub}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      <div className="max-w-[920px] mx-auto w-full p-6">
        {tab === "databases" && <DatabasesPanel />}
        {tab === "documents" && (
          <>
            <p className="text-[12px] text-[var(--text-muted)] mb-4">
              Uploaded documents are parsed, indexed, and surfaced in the wiki under the
              <strong> Business documents</strong> section. Supported: PDF, DOCX, Markdown,
              plain text.
            </p>
            <UploadForm />
          </>
        )}
        {tab === "repositories" && (
          <>
            <p className="text-[12px] text-[var(--text-muted)] mb-4">
              Connected GitLab repositories are walked, ingested module-by-module, and
              surfaced in the wiki under the <strong>GitLab</strong> section. Re-syncs
              every ~5 minutes.
            </p>
            <ConnectForm />
          </>
        )}
      </div>
    </main>
  );
}

type InspectTable = {
  qualified: string;
  name: string;
  kind: "table" | "view";
  row_estimate: number;
  n_columns: number;
};
type InspectSchema = { schema: string; tables: InspectTable[] };

function DatabasesPanel() {
  const [sources, setSources] = useState<Source[]>([]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("postgres");
  const [conn, setConn] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [inspect, setInspect] = useState<InspectSchema[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<"form" | "pick">("form");

  async function refresh() {
    const r = await fetch("/api/connections").then((r) => r.json());
    setSources(r.sources ?? []);
  }
  useEffect(() => {
    void refresh();
    const iv = setInterval(refresh, 2000);
    return () => clearInterval(iv);
  }, []);

  async function doInspect(e: React.FormEvent) {
    e.preventDefault();
    if (!conn) return;
    if (kind !== "postgres") {
      // Snowflake / Databricks aren't actively profiled in v0.1 — just record.
      return submitFinal();
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/connections/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conn_url: conn }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setMsg(`Could not connect: ${j.error ?? r.statusText}`);
        return;
      }
      setInspect(j.schemas as InspectSchema[]);
      // Default to everything checked
      const all = new Set<string>();
      for (const s of (j.schemas as InspectSchema[])) {
        for (const t of s.tables) all.add(t.qualified);
      }
      setPicked(all);
      setStep("pick");
    } finally {
      setBusy(false);
    }
  }

  async function submitFinal() {
    if (!name || !conn) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          kind,
          conn_url: conn,
          included_tables: inspect ? Array.from(picked) : undefined,
        }),
      });
      if (!r.ok) {
        const j = await r.json();
        setMsg(`Error: ${j.error ?? "unknown"}`);
      } else {
        const total = inspect ? picked.size : "all";
        setMsg(`Added ${name} (${total} table${total === 1 ? "" : "s"} in scope). Loom will start profiling on the next boot tick.`);
        setName("");
        setConn("");
        setInspect(null);
        setPicked(new Set());
        setStep("form");
        void refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  function togglePicked(q: string) {
    const next = new Set(picked);
    if (next.has(q)) next.delete(q);
    else next.add(q);
    setPicked(next);
  }
  function pickSchema(schema: string, all: boolean) {
    const next = new Set(picked);
    const tables = inspect?.find((s) => s.schema === schema)?.tables ?? [];
    for (const t of tables) {
      if (all) next.add(t.qualified);
      else next.delete(t.qualified);
    }
    setPicked(next);
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-sm font-semibold mb-3">Connected sources</h2>
        <div className="space-y-2">
          {sources.length === 0 && (
            <div className="text-[12px] text-[var(--text-muted)] px-2 py-6 text-center border border-dashed border-[var(--border)] rounded">
              No connections yet.
            </div>
          )}
          {sources.map((s) => (
            <div
              key={s.id}
              className="rounded-lg border border-[var(--border)] bg-[var(--bg-elev)] px-4 py-3 flex items-center justify-between"
            >
              <div>
                <div className="text-sm font-medium">{s.name}</div>
                <div className="text-[11px] text-[var(--text-muted)] font-mono">
                  {s.kind} · {s.conn_url}
                </div>
              </div>
              <div className="text-[11px] text-[var(--text-muted)]">
                <span className="text-[var(--accent)] font-semibold">{s.ready_tables}</span>
                /{s.total_tables} ready
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-3">
          {step === "form" ? "Connect a new source" : `Pick tables to ingest (${picked.size} selected)`}
        </h2>
        {step === "form" ? (
          <form onSubmit={doInspect} className="space-y-3 max-w-xl">
            <Field label="Name">
              <input
                className="db-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. warehouse_prod"
              />
            </Field>
            <Field label="Kind">
              <select className="db-input" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="postgres">Postgres</option>
                <option value="snowflake">Snowflake</option>
                <option value="databricks">Databricks</option>
              </select>
            </Field>
            <Field label="Connection URL">
              <input
                className="db-input font-mono text-[12px]"
                value={conn}
                onChange={(e) => setConn(e.target.value)}
                placeholder={connHint(kind)}
              />
              <p className="text-[10px] text-[var(--text-faint)] mt-1">{connNote(kind)}</p>
            </Field>
            <div className="flex items-center gap-3">
              <button
                disabled={busy || !name || !conn}
                className="bg-[var(--accent)] text-white font-medium text-sm px-4 py-2 rounded-lg disabled:opacity-40 hover:bg-indigo-600 transition"
              >
                {kind === "postgres" ? (busy ? "Inspecting…" : "Inspect tables →") : busy ? "Saving…" : "Save connection"}
              </button>
              {msg ? <span className="text-[12px] text-[var(--text-muted)]">{msg}</span> : null}
            </div>
            <p className="text-[11px] text-[var(--text-faint)]">
              Postgres connections preview the available schemas + tables so you can pick what to ingest.
              Snowflake / Databricks are recorded; their profiling workers land in v0.5.
            </p>
          </form>
        ) : (
          <div className="space-y-3 max-w-3xl">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] divide-y divide-[var(--border)] max-h-[420px] overflow-y-auto">
              {inspect?.map((s) => {
                const allChecked = s.tables.every((t) => picked.has(t.qualified));
                const anyChecked = s.tables.some((t) => picked.has(t.qualified));
                return (
                  <div key={s.schema}>
                    <div className="px-4 py-2 bg-[var(--bg-soft)] flex items-center gap-3 sticky top-0">
                      <label className="flex items-center gap-2 text-[12px] font-semibold text-[var(--text)] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={allChecked}
                          ref={(el) => {
                            if (el) el.indeterminate = !allChecked && anyChecked;
                          }}
                          onChange={() => pickSchema(s.schema, !allChecked)}
                        />
                        <span className="font-mono">{s.schema}</span>
                      </label>
                      <span className="text-[10px] text-[var(--text-faint)] ml-auto">
                        {s.tables.length} table{s.tables.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <ul>
                      {s.tables.map((t) => (
                        <li key={t.qualified}>
                          <label className="flex items-center gap-3 px-6 py-1.5 text-[12px] hover:bg-[var(--bg-soft)] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={picked.has(t.qualified)}
                              onChange={() => togglePicked(t.qualified)}
                            />
                            <span className="font-mono text-[var(--text)] flex-1">{t.name}</span>
                            <span className="text-[10px] text-[var(--text-faint)] uppercase tracking-wider">{t.kind}</span>
                            <span className="text-[10px] text-[var(--text-muted)] tabular-nums w-16 text-right">
                              {t.row_estimate.toLocaleString()} rows
                            </span>
                            <span className="text-[10px] text-[var(--text-muted)] tabular-nums w-10 text-right">
                              {t.n_columns} cols
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={submitFinal}
                disabled={busy || picked.size === 0}
                className="bg-[var(--accent)] text-white font-medium text-sm px-4 py-2 rounded-lg disabled:opacity-40 hover:bg-indigo-600 transition"
              >
                {busy ? "Saving…" : `Connect ${picked.size} table${picked.size === 1 ? "" : "s"}`}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep("form");
                  setInspect(null);
                  setPicked(new Set());
                }}
                className="text-[12px] text-[var(--text-muted)] hover:text-[var(--text)]"
              >
                ← back
              </button>
              {msg ? <span className="text-[12px] text-[var(--text-muted)]">{msg}</span> : null}
            </div>
          </div>
        )}
      </section>

      <style>{`
        .db-input {
          width: 100%;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 8px 10px;
          font-size: 13px;
          color: var(--text);
          outline: none;
        }
        .db-input:focus { border-color: var(--accent); }
      `}</style>
    </div>
  );
}

function connHint(kind: string): string {
  switch (kind) {
    case "snowflake":
      return "snowflake://USER:PASSWORD@ACCOUNT/DATABASE/SCHEMA?warehouse=WH&role=ROLE";
    case "databricks":
      return "databricks://TOKEN@HOST/sql/1.0/warehouses/WAREHOUSE_ID";
    default:
      return "postgres://user:pass@host:5432/db";
  }
}

function connNote(kind: string): string {
  switch (kind) {
    case "snowflake":
    case "databricks":
      return "Connection recorded. Profiling worker for this kind lands in v0.5.";
    default:
      return "Postgres: actively profiled by Loop 1 + Loop 2 on next boot tick.";
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] mb-1 font-semibold">
        {label}
      </div>
      {children}
    </label>
  );
}
