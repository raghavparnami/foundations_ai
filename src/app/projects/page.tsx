"use client";
import { useEffect, useState } from "react";

type Project = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  table_ids?: number[];
};

type TableRow = {
  id: number;
  schema: string;
  name: string;
  source: string;
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tables, setTables] = useState<TableRow[]>([]);
  const [editing, setEditing] = useState<(Project & { table_ids: number[] }) | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    const [pj, c] = await Promise.all([
      fetch("/api/projects").then((r) => r.json()),
      fetch("/api/catalog").then((r) => r.json()),
    ]);
    setProjects(pj.projects ?? []);
    setTables(c.tables ?? []);
  }
  useEffect(() => {
    void refresh();
  }, []);

  async function startEdit(p: Project) {
    setMsg(null);
    const r = await fetch(`/api/projects/${p.slug}`).then((r) => r.json());
    setEditing(r.project as Project & { table_ids: number[] });
  }
  function startNew() {
    setMsg(null);
    setEditing("new");
  }

  return (
    <main className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      <header className="px-6 py-3 border-b border-[var(--border)] bg-[var(--bg-elev)] flex items-center justify-between">
        <div>
          <h1 className="text-sm font-semibold">Projects</h1>
          <p className="text-[11px] text-[var(--text-muted)] -mt-0.5">
            scope the agent to a curated subset of tables per use case
          </p>
        </div>
        <button
          onClick={startNew}
          className="bg-[var(--accent)] text-white font-medium text-sm px-4 py-2 rounded-lg hover:bg-emerald-700 transition"
        >
          New project
        </button>
      </header>

      <div className="max-w-[1000px] mx-auto w-full p-6 grid grid-cols-12 gap-6">
        <div className="col-span-5 space-y-2">
          {projects.length === 0 && (
            <div className="text-[12px] text-[var(--text-muted)] px-2 py-6 text-center border border-dashed border-[var(--border)] rounded">
              No projects yet. Create one to scope the chat agent to a subset
              of your tables.
            </div>
          )}
          {projects.map((p) => (
            <button
              key={p.slug}
              onClick={() => startEdit(p)}
              className={`block w-full text-left rounded-lg border px-4 py-3 transition ${
                editing && typeof editing === "object" && editing.slug === p.slug
                  ? "border-[var(--accent)] bg-[var(--bg-elev)]"
                  : "border-[var(--border)] bg-[var(--bg-elev)] hover:border-[var(--accent)]"
              }`}
            >
              <div className="text-sm font-medium">{p.name}</div>
              <div className="text-[11px] text-[var(--text-muted)] mt-0.5 line-clamp-2">
                {p.description ?? <span className="italic">No description</span>}
              </div>
              <div className="text-[10px] text-[var(--text-faint)] mt-1 font-mono">slug: {p.slug}</div>
            </button>
          ))}
        </div>

        <div className="col-span-7">
          {!editing ? (
            <div className="text-[12px] text-[var(--text-muted)] px-2 py-12 text-center border border-dashed border-[var(--border)] rounded">
              Select a project to edit, or click <strong>New project</strong>.
            </div>
          ) : (
            <ProjectForm
              initial={editing === "new" ? null : editing}
              tables={tables}
              busy={busy}
              setBusy={setBusy}
              msg={msg}
              setMsg={setMsg}
              onSaved={async () => {
                await refresh();
                setEditing(null);
              }}
              onCancel={() => setEditing(null)}
              onDelete={async (slug) => {
                if (!confirm(`Delete project "${slug}"?`)) return;
                await fetch(`/api/projects/${slug}`, { method: "DELETE" });
                await refresh();
                setEditing(null);
              }}
            />
          )}
        </div>
      </div>

      <style>{`
        .input {
          width: 100%;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 8px 10px;
          font-size: 13px;
          color: var(--text);
          outline: none;
        }
        .input:focus { border-color: var(--accent); }
      `}</style>
    </main>
  );
}

function ProjectForm({
  initial,
  tables,
  busy,
  setBusy,
  msg,
  setMsg,
  onSaved,
  onCancel,
  onDelete,
}: {
  initial: (Project & { table_ids: number[] }) | null;
  tables: TableRow[];
  busy: boolean;
  setBusy: (b: boolean) => void;
  msg: string | null;
  setMsg: (s: string | null) => void;
  onSaved: () => Promise<void>;
  onCancel: () => void;
  onDelete: (slug: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [tableIds, setTableIds] = useState<Set<number>>(new Set(initial?.table_ids ?? []));

  function toggle(id: number) {
    const next = new Set(tableIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setTableIds(next);
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: slug || name,
          name,
          description,
          table_ids: Array.from(tableIds),
        }),
      });
      if (!r.ok) {
        const j = await r.json();
        setMsg(`Error: ${j.error ?? "unknown"}`);
      } else {
        setMsg("Saved");
        await onSaved();
      }
    } finally {
      setBusy(false);
    }
  }

  const grouped: Record<string, TableRow[]> = {};
  for (const t of tables) {
    (grouped[t.source] ??= []).push(t);
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Q3 Quality Audit" />
        </Field>
        <Field label="Slug (auto-generated if blank)">
          <input className="input" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="q3-quality-audit" disabled={!!initial} />
        </Field>
      </div>
      <Field label="Description">
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Focus on Line A deviations and quality misses" />
      </Field>

      <div>
        <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] mb-2 font-semibold">
          Tables in scope ({tableIds.size}/{tables.length})
        </div>
        <div className="max-h-[340px] overflow-y-auto border border-[var(--border)] rounded-lg divide-y divide-[var(--border)]">
          {Object.entries(grouped).map(([source, group]) => (
            <div key={source}>
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-[var(--text-faint)] bg-[var(--bg-soft)] font-mono">
                {source}
              </div>
              {group.map((t) => (
                <label
                  key={t.id}
                  className="flex items-center gap-3 px-3 py-1.5 hover:bg-[var(--bg-soft)] cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={tableIds.has(t.id)}
                    onChange={() => toggle(t.id)}
                  />
                  <span className="text-[13px] font-mono">
                    {t.schema}.{t.name}
                  </span>
                </label>
              ))}
            </div>
          ))}
          {tables.length === 0 && (
            <div className="text-[12px] text-[var(--text-muted)] px-3 py-6 text-center">
              No tables in catalog yet.
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          disabled={busy || !name.trim()}
          onClick={save}
          className="bg-[var(--accent)] text-white font-medium text-sm px-4 py-2 rounded-lg disabled:opacity-40 hover:bg-emerald-700 transition"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button onClick={onCancel} className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]">
          Cancel
        </button>
        {initial && (
          <button
            onClick={() => onDelete(initial.slug)}
            className="ml-auto text-sm text-red-600 hover:text-red-700"
          >
            Delete
          </button>
        )}
        {msg && <span className="text-[12px] text-[var(--text-muted)]">{msg}</span>}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] mb-1 font-semibold">{label}</div>
      {children}
    </label>
  );
}
