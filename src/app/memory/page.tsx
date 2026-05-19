"use client";
import { useEffect, useState } from "react";

type Memory = {
  id: number;
  scope: "user" | "workspace";
  kind: "preference" | "fact" | "rule" | "glossary" | "other";
  content: string;
  importance: number;
  source: string;
  conversation_id: string | null;
  use_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

const SCOPES: Memory["scope"][] = ["user", "workspace"];
const KINDS: Memory["kind"][] = ["preference", "fact", "rule", "glossary", "other"];

export default function MemoryPage() {
  const [items, setItems] = useState<Memory[]>([]);
  const [scopeFilter, setScopeFilter] = useState<"all" | Memory["scope"]>("all");
  const [adding, setAdding] = useState(false);

  async function refresh() {
    const r = await fetch("/api/memories");
    const j = await r.json();
    setItems(j.memories ?? []);
  }
  useEffect(() => {
    void refresh();
    const iv = setInterval(refresh, 4000);
    return () => clearInterval(iv);
  }, []);

  const filtered = scopeFilter === "all" ? items : items.filter((m) => m.scope === scopeFilter);

  return (
    <main className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      <header className="px-6 py-3 border-b border-[var(--border)] bg-[var(--bg-elev)] flex items-center justify-between">
        <div>
          <h1 className="text-sm font-semibold">Memory</h1>
          <p className="text-[11px] text-[var(--text-muted)] -mt-0.5">
            durable facts, rules, and preferences the agent loads into every relevant chat
          </p>
        </div>
        <button
          onClick={() => setAdding((a) => !a)}
          className="text-[12px] px-3 py-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-elev)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition"
        >
          {adding ? "Cancel" : "+ Add memory"}
        </button>
      </header>

      <div className="max-w-[920px] mx-auto w-full p-6 space-y-5">
        {adding && <AddForm onDone={async () => { setAdding(false); await refresh(); }} />}

        <div className="flex items-center gap-2 text-[12px]">
          <span className="text-[var(--text-faint)] mr-2">Filter:</span>
          {(["all", ...SCOPES] as const).map((s) => (
            <button
              key={s}
              onClick={() => setScopeFilter(s)}
              className={`px-3 py-1 rounded-full border ${
                scopeFilter === s
                  ? "bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent)]/30"
                  : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              {s}
            </button>
          ))}
          <span className="ml-auto text-[11px] text-[var(--text-faint)]">
            {filtered.length} {filtered.length === 1 ? "memory" : "memories"}
          </span>
        </div>

        <ul className="space-y-2">
          {filtered.length === 0 && (
            <li className="text-[12px] text-[var(--text-muted)] px-2 py-8 text-center border border-dashed border-[var(--border)] rounded-lg">
              No memories yet. The agent can save them via the <code>remember</code> tool, or you can add one manually.
            </li>
          )}
          {filtered.map((m) => (
            <MemoryCard key={m.id} m={m} onChanged={refresh} />
          ))}
        </ul>

        <p className="text-[11px] text-[var(--text-faint)] pt-2">
          Memories ranked higher (importance × use count × recency) are injected first into the agent's
          system prompt when the user's question matches their content.
        </p>
      </div>
    </main>
  );
}

function MemoryCard({ m, onChanged }: { m: Memory; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(m.content);
  const [importance, setImportance] = useState(m.importance);
  const [scope, setScope] = useState(m.scope);
  const [kind, setKind] = useState(m.kind);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await fetch(`/api/memories/${m.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, importance, scope, kind }),
      });
      setEditing(false);
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete memory: "${m.content.slice(0, 60)}…"?`)) return;
    setBusy(true);
    try {
      await fetch(`/api/memories/${m.id}`, { method: "DELETE" });
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <li className="rounded-lg border border-[var(--accent)]/40 bg-[var(--bg-elev)] p-4 space-y-3">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={3}
          className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-md px-3 py-2 text-[13px] outline-none focus:border-[var(--accent)]"
        />
        <div className="flex items-center gap-3 text-[12px]">
          <label className="flex items-center gap-2">
            <span className="text-[var(--text-faint)]">Scope</span>
            <select className="bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1" value={scope} onChange={(e) => setScope(e.target.value as Memory["scope"])}>
              {SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-[var(--text-faint)]">Kind</span>
            <select className="bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1" value={kind} onChange={(e) => setKind(e.target.value as Memory["kind"])}>
              {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-[var(--text-faint)]">Importance</span>
            <input type="number" min={1} max={5} value={importance} onChange={(e) => setImportance(Number(e.target.value))} className="w-12 bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1" />
          </label>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={busy} className="bg-[var(--accent)] text-white text-[12px] font-medium px-3 py-1.5 rounded-md disabled:opacity-40">Save</button>
          <button onClick={() => setEditing(false)} className="text-[12px] text-[var(--text-muted)] hover:text-[var(--text)]">Cancel</button>
        </div>
      </li>
    );
  }

  return (
    <li className="rounded-lg border border-[var(--border)] bg-[var(--bg-elev)] p-4">
      <div className="flex items-start gap-3">
        <ImportanceBar n={m.importance} />
        <div className="flex-1 min-w-0">
          <p className="text-[13.5px] text-[var(--text)] leading-relaxed">{m.content}</p>
          <div className="mt-2 flex items-center gap-2 text-[10px] uppercase tracking-wider font-semibold text-[var(--text-faint)]">
            <Pill kind={m.scope}>{m.scope}</Pill>
            <Pill>{m.kind}</Pill>
            <Pill kind="muted">used ×{m.use_count}</Pill>
            <span className="ml-auto normal-case font-normal tracking-normal text-[var(--text-faint)]">
              {relTime(m.last_used_at) || `created ${relTime(m.created_at)}`}
            </span>
          </div>
        </div>
        <div className="flex gap-1">
          <button onClick={() => setEditing(true)} className="text-[11px] px-2 py-1 text-[var(--text-muted)] hover:text-[var(--accent)]" disabled={busy}>Edit</button>
          <button onClick={remove} className="text-[11px] px-2 py-1 text-[var(--text-muted)] hover:text-red-600" disabled={busy}>Delete</button>
        </div>
      </div>
    </li>
  );
}

function AddForm({ onDone }: { onDone: () => Promise<void> }) {
  const [content, setContent] = useState("");
  const [scope, setScope] = useState<Memory["scope"]>("user");
  const [kind, setKind] = useState<Memory["kind"]>("preference");
  const [importance, setImportance] = useState(3);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setBusy(true);
    try {
      const r = await fetch("/api/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, scope, kind, importance }),
      });
      if (r.ok) {
        setContent("");
        await onDone();
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="rounded-lg border border-[var(--accent)]/30 bg-[var(--accent-soft)]/40 p-4 space-y-3">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="e.g. Always group deviation analysis by production line first."
        rows={3}
        className="w-full bg-[var(--bg-elev)] border border-[var(--border)] rounded-md px-3 py-2 text-[13px] outline-none focus:border-[var(--accent)]"
        autoFocus
      />
      <div className="flex items-center gap-3 text-[12px]">
        <label className="flex items-center gap-2">
          <span className="text-[var(--text-faint)]">Scope</span>
          <select className="bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1" value={scope} onChange={(e) => setScope(e.target.value as Memory["scope"])}>
            {SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-[var(--text-faint)]">Kind</span>
          <select className="bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1" value={kind} onChange={(e) => setKind(e.target.value as Memory["kind"])}>
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-[var(--text-faint)]">Importance</span>
          <input type="number" min={1} max={5} value={importance} onChange={(e) => setImportance(Number(e.target.value))} className="w-12 bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1" />
        </label>
        <button type="submit" disabled={busy || !content.trim()} className="ml-auto bg-[var(--accent)] text-white text-[12px] font-medium px-3 py-1.5 rounded-md disabled:opacity-40">
          {busy ? "Saving…" : "Save memory"}
        </button>
      </div>
    </form>
  );
}

function Pill({ children, kind }: { children: React.ReactNode; kind?: "user" | "workspace" | "muted" }) {
  const cls =
    kind === "workspace"
      ? "bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent)]/30"
      : kind === "user"
        ? "bg-purple-50 text-purple-700 border-purple-200"
        : kind === "muted"
          ? "bg-[var(--bg)] text-[var(--text-muted)] border-[var(--border)]"
          : "bg-[var(--bg)] text-[var(--text)] border-[var(--border)]";
  return (
    <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${cls}`}>{children}</span>
  );
}

function ImportanceBar({ n }: { n: number }) {
  return (
    <div className="flex flex-col gap-0.5 mt-1.5">
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className="w-1 h-1.5 rounded-sm" style={{ background: i < n ? "var(--accent)" : "var(--border)" }} />
      ))}
    </div>
  );
}

function relTime(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  const m = Math.round(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
