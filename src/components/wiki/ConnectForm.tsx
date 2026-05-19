"use client";
import { useEffect, useState } from "react";

type Repo = {
  id: number;
  provider: string;
  display_name: string;
  project_path: string;
  base_url: string;
  default_branch: string;
  status: string;
  last_synced_at: string | null;
  file_count: number;
};

export default function ConnectForm() {
  const [form, setForm] = useState({
    provider: "gitlab",
    display_name: "",
    project_path: "",
    base_url: "https://gitlab.com",
    default_branch: "main",
    token_ref: "",
    include_globs: "**/*.md,**/*.ts,**/*.py,**/*.sql",
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [repos, setRepos] = useState<Repo[]>([]);

  async function refresh() {
    try {
      const r = await fetch("/api/wiki/code-sources");
      const j = await r.json();
      setRepos(j.sources ?? []);
    } catch {
      /* swallow */
    }
  }
  useEffect(() => {
    void refresh();
    const iv = setInterval(refresh, 5000);
    return () => clearInterval(iv);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/wiki/code-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: form.provider,
          display_name: form.display_name,
          project_path: form.project_path,
          base_url: form.base_url,
          default_branch: form.default_branch,
          token_ref: form.token_ref || undefined,
          include_globs: form.include_globs
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setMsg(`Error: ${j.error ?? r.statusText}`);
      } else {
        setMsg(`Registered ${form.display_name}. The code-wiki agent will ingest it shortly.`);
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-8">
      <form
        onSubmit={submit}
        className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-6 space-y-4"
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Display name">
            <input
              className="loom-input"
              value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
              placeholder="loom/etl-pipelines"
              required
            />
          </Field>
          <Field label="Provider">
            <select
              className="loom-input"
              value={form.provider}
              onChange={(e) => setForm({ ...form, provider: e.target.value })}
            >
              <option value="gitlab">GitLab</option>
              <option value="github" disabled>GitHub (coming v0.5)</option>
            </select>
          </Field>
        </div>
        <Field label="GitLab project path">
          <input
            className="loom-input font-mono text-[12px]"
            value={form.project_path}
            onChange={(e) => setForm({ ...form, project_path: e.target.value })}
            placeholder="group/sub/project"
            required
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Base URL">
            <input
              className="loom-input font-mono text-[12px]"
              value={form.base_url}
              onChange={(e) => setForm({ ...form, base_url: e.target.value })}
            />
          </Field>
          <Field label="Default branch">
            <input
              className="loom-input font-mono text-[12px]"
              value={form.default_branch}
              onChange={(e) => setForm({ ...form, default_branch: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Token env var (optional)">
          <input
            className="loom-input font-mono text-[12px]"
            value={form.token_ref}
            onChange={(e) => setForm({ ...form, token_ref: e.target.value })}
            placeholder="LOOM_GITLAB_TOKEN"
          />
          <p className="mt-1 text-[10px] text-[var(--text-faint)]">
            Set the env var in <code>.env.local</code> and reference its name
            here. We never store tokens in the catalog DB.
          </p>
        </Field>
        <Field label="Include globs">
          <input
            className="loom-input font-mono text-[12px]"
            value={form.include_globs}
            onChange={(e) => setForm({ ...form, include_globs: e.target.value })}
          />
          <p className="mt-1 text-[10px] text-[var(--text-faint)]">
            Comma-separated. Examples: <code>**/*.md</code>, <code>src/**/*.ts</code>.
          </p>
        </Field>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={busy || !form.display_name || !form.project_path}
            className="bg-[var(--accent)] text-white text-[13px] font-medium px-4 py-2 rounded-md hover:bg-indigo-600 disabled:opacity-40 transition"
          >
            {busy ? "Connecting…" : "Connect repository"}
          </button>
          {msg && <span className="text-[12px] text-[var(--text-muted)]">{msg}</span>}
        </div>
      </form>

      <section>
        <h2 className="text-[14px] font-semibold mb-3">Connected repos ({repos.length})</h2>
        {repos.length === 0 ? (
          <div className="px-4 py-8 text-center text-[12px] text-[var(--text-muted)] border border-dashed border-[var(--border)] rounded-lg">
            No repos yet. Add one above.
          </div>
        ) : (
          <ul className="border border-[var(--border)] rounded-lg divide-y divide-[var(--border)] overflow-hidden">
            {repos.map((r) => (
              <li key={r.id} className="px-4 py-3 flex items-center gap-4 text-[12px]">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{
                    background:
                      r.status === "ready" ? "#10b981" : r.status === "syncing" ? "#7c3aed" : r.status === "failed" ? "#ef4444" : "#fbbf24",
                  }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[var(--text)] font-medium">{r.display_name}</div>
                  <div className="text-[10px] text-[var(--text-faint)] font-mono">
                    {r.provider} · {r.project_path} @ {r.default_branch} · {r.file_count} files · {r.status}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <style jsx global>{`
        .loom-input {
          width: 100%;
          background: var(--bg-elev);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 7px 10px;
          font-size: 13px;
          color: var(--text);
          outline: none;
        }
        .loom-input:focus { border-color: var(--accent); }
      `}</style>
    </div>
  );
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
