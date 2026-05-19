"use client";
import { useEffect, useState } from "react";

type Skill = {
  id: number;
  slug: string;
  name: string;
  description: string;
  triggers: string[];
  body_md: string;
  enabled: boolean;
  updated_at: string;
};

const STARTER_BODY = `## What it is
[Short definition]

## Required columns
- \`column_a\` (type)
- \`column_b\` (type)

## SQL template
\`\`\`sql
SELECT ...
FROM ...
\`\`\`

## What a good output looks like
A short Markdown table with N rows and a one-line summary.
`;

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [editing, setEditing] = useState<Partial<Skill> & { triggersText?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    const r = await fetch("/api/skills").then((r) => r.json());
    setSkills(r.skills ?? []);
  }
  useEffect(() => {
    void refresh();
  }, []);

  function startNew() {
    setEditing({
      slug: "",
      name: "",
      description: "",
      triggers: [],
      triggersText: "",
      body_md: STARTER_BODY,
      enabled: true,
    });
    setMsg(null);
  }

  function startEdit(s: Skill) {
    setEditing({ ...s, triggersText: s.triggers.join(", ") });
    setMsg(null);
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    setMsg(null);
    try {
      const triggers = (editing.triggersText ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const slug = editing.slug || editing.name || "";
      const r = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          name: editing.name,
          description: editing.description,
          triggers,
          body_md: editing.body_md,
          enabled: editing.enabled,
        }),
      });
      if (!r.ok) {
        const j = await r.json();
        setMsg(`Error: ${j.error ?? "unknown"}`);
      } else {
        setMsg("Saved");
        setEditing(null);
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(slug: string) {
    if (!confirm(`Delete skill "${slug}"?`)) return;
    await fetch(`/api/skills/${slug}`, { method: "DELETE" });
    await refresh();
  }

  return (
    <main className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      <header className="px-6 py-3 border-b border-[var(--border)] bg-[var(--bg-elev)] flex items-center justify-between">
        <div>
          <h1 className="text-sm font-semibold">Skills</h1>
          <p className="text-[11px] text-[var(--text-muted)] -mt-0.5">
            analytical playbooks the agent loads when your question matches a trigger
          </p>
        </div>
        <button
          onClick={startNew}
          className="bg-[var(--accent)] text-white font-medium text-sm px-4 py-2 rounded-lg hover:bg-emerald-700 transition"
        >
          New skill
        </button>
      </header>

      <div className="max-w-[920px] mx-auto w-full p-6 grid grid-cols-12 gap-6">
        <div className="col-span-5 space-y-2">
          {skills.length === 0 && (
            <div className="text-[12px] text-[var(--text-muted)] px-2 py-6 text-center border border-dashed border-[var(--border)] rounded">
              No skills yet. Add one — the agent will use it when its trigger words appear in a question.
            </div>
          )}
          {skills.map((s) => (
            <button
              key={s.slug}
              onClick={() => startEdit(s)}
              className={`block w-full text-left rounded-lg border px-4 py-3 transition ${
                editing && "slug" in editing && editing.slug === s.slug
                  ? "border-[var(--accent)] bg-[var(--bg-elev)]"
                  : "border-[var(--border)] bg-[var(--bg-elev)] hover:border-[var(--accent)]"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{s.name}</span>
                {!s.enabled && (
                  <span className="text-[10px] text-[var(--text-faint)] uppercase">disabled</span>
                )}
              </div>
              <div className="text-[11px] text-[var(--text-muted)] mt-0.5 line-clamp-2">
                {s.description}
              </div>
              <div className="text-[10px] text-[var(--text-faint)] mt-1 font-mono">
                triggers: {s.triggers.join(", ") || "—"}
              </div>
            </button>
          ))}
        </div>
        <div className="col-span-7">
          {!editing ? (
            <div className="text-[12px] text-[var(--text-muted)] px-2 py-12 text-center border border-dashed border-[var(--border)] rounded">
              Select a skill on the left to edit, or click <strong>New skill</strong>.
            </div>
          ) : (
            <div className="space-y-3">
              <Field label="Name">
                <input
                  className="input"
                  value={editing.name ?? ""}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="Deviation Rate"
                />
              </Field>
              <Field label="Slug (auto-generated if blank)">
                <input
                  className="input"
                  value={editing.slug ?? ""}
                  onChange={(e) => setEditing({ ...editing, slug: e.target.value })}
                  placeholder="deviation-rate"
                />
              </Field>
              <Field label="Description">
                <input
                  className="input"
                  value={editing.description ?? ""}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  placeholder="Computes deviation rate for QA/manufacturing use cases."
                />
              </Field>
              <Field label="Triggers (comma-separated keywords)">
                <input
                  className="input font-mono text-[12px]"
                  value={editing.triggersText ?? ""}
                  onChange={(e) => setEditing({ ...editing, triggersText: e.target.value })}
                  placeholder="deviation, defect rate, quality variance, non-conformance"
                />
              </Field>
              <Field label="Playbook (Markdown)">
                <textarea
                  className="input font-mono text-[12px]"
                  rows={16}
                  value={editing.body_md ?? ""}
                  onChange={(e) => setEditing({ ...editing, body_md: e.target.value })}
                />
              </Field>
              <label className="flex items-center gap-2 text-[12px]">
                <input
                  type="checkbox"
                  checked={editing.enabled ?? true}
                  onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
                />
                Enabled
              </label>
              <div className="flex items-center gap-3">
                <button
                  disabled={busy}
                  onClick={save}
                  className="bg-[var(--accent)] text-white font-medium text-sm px-4 py-2 rounded-lg disabled:opacity-40 hover:bg-emerald-700 transition"
                >
                  Save
                </button>
                <button
                  onClick={() => setEditing(null)}
                  className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
                >
                  Cancel
                </button>
                {editing.slug && skills.some((s) => s.slug === editing.slug) && (
                  <button
                    onClick={() => editing.slug && remove(editing.slug)}
                    className="ml-auto text-sm text-red-600 hover:text-red-700"
                  >
                    Delete
                  </button>
                )}
                {msg && <span className="text-[12px] text-[var(--text-muted)]">{msg}</span>}
              </div>
            </div>
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
        textarea.input { resize: vertical; line-height: 1.5; }
      `}</style>
    </main>
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
