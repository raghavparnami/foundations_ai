import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";

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

type SkillCandidate = {
  id: number;
  conversation_id: string | null;
  slug: string;
  name: string;
  description: string;
  triggers: string[];
  body_md: string;
  created_at: string;
};

type SkillsResp = { skills: Skill[] };
type CandidatesResp = { candidates: SkillCandidate[] };

type NewSkillForm = {
  name: string;
  description: string;
  triggersText: string;
  body_md: string;
};

const EMPTY_FORM: NewSkillForm = {
  name: "",
  description: "",
  triggersText: "",
  body_md: "",
};

export default function Skills() {
  const qc = useQueryClient();
  const skillsQ = useQuery<SkillsResp>({
    queryKey: ["skills"],
    queryFn: () => api.get<SkillsResp>("/api/skills"),
    refetchInterval: 4_000,
  });
  const candidatesQ = useQuery<CandidatesResp>({
    queryKey: ["skill-candidates"],
    queryFn: () => api.get<CandidatesResp>("/api/skill-candidates"),
    refetchInterval: 4_000,
  });

  const [form, setForm] = useState<NewSkillForm>(EMPTY_FORM);

  const create = useMutation({
    mutationFn: (body: {
      name: string;
      description: string;
      triggers: string[];
      body_md: string;
      enabled: boolean;
    }) => api.post("/api/skills", body),
    onSuccess: () => {
      setForm(EMPTY_FORM);
      void qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });

  const toggleEnabled = useMutation({
    mutationFn: (s: Skill) =>
      api.post("/api/skills", {
        slug: s.slug,
        name: s.name,
        description: s.description,
        triggers: s.triggers,
        body_md: s.body_md,
        enabled: !s.enabled,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["skills"] }),
  });

  const remove = useMutation({
    mutationFn: (slug: string) => api.delete(`/api/skills/${slug}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["skills"] }),
  });

  const accept = useMutation({
    mutationFn: (id: number) => api.post(`/api/skill-candidates/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["skill-candidates"] });
      void qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });

  const dismiss = useMutation({
    mutationFn: (id: number) => api.delete(`/api/skill-candidates/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["skill-candidates"] }),
  });

  const skills = skillsQ.data?.skills ?? [];
  const candidates = candidatesQ.data?.candidates ?? [];

  return (
    <div className="h-full overflow-auto p-8">
      <h1 className="text-2xl font-semibold">Skills</h1>
      <p className="mt-2 max-w-xl text-[var(--text-muted)]">
        Analytical playbooks the agent loads when a question matches a trigger.
      </p>

      <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--bg-soft)] p-5">
        <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--text-muted)]">
          New skill
        </h2>
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.name.trim()) return;
            const triggers = form.triggersText
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean);
            create.mutate({
              name: form.name,
              description: form.description,
              triggers,
              body_md: form.body_md,
              enabled: true,
            });
          }}
        >
          <input
            placeholder="Name (e.g. Deviation Rate)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full rounded border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <input
            placeholder="Description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full rounded border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <input
            placeholder="Triggers (comma-separated)"
            value={form.triggersText}
            onChange={(e) => setForm({ ...form, triggersText: e.target.value })}
            className="w-full rounded border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2 font-mono text-sm outline-none focus:border-blue-500"
          />
          <textarea
            placeholder="Playbook body (Markdown)"
            value={form.body_md}
            onChange={(e) => setForm({ ...form, body_md: e.target.value })}
            rows={10}
            className="w-full rounded border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2 font-mono text-xs outline-none focus:border-blue-500"
          />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={create.isPending || !form.name.trim()}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {create.isPending ? "Saving…" : "Save skill"}
            </button>
            {create.isError && (
              <span className="text-sm text-red-600">
                {(create.error as Error).message}
              </span>
            )}
          </div>
        </form>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-[var(--text-muted)]">
          Pending candidates
        </h2>
        {candidates.length === 0 ? (
          <p className="text-sm text-[var(--text-faint)]">No pending candidates.</p>
        ) : (
          <div className="space-y-2">
            {candidates.map((c) => (
              <div
                key={c.id}
                className="rounded border border-[var(--border)] bg-[var(--bg-soft)] p-4 text-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-[var(--text)]">{c.name}</div>
                    <div className="mt-0.5 text-[var(--text-muted)]">{c.description}</div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {c.triggers.map((t) => (
                        <span
                          key={t}
                          className="rounded-full border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-0.5 font-mono text-[11px] text-[var(--text-muted)]"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => accept.mutate(c.id)}
                      disabled={accept.isPending}
                      className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-40"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => dismiss.mutate(c.id)}
                      disabled={dismiss.isPending}
                      className="rounded border border-[var(--border)] px-3 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-[var(--text-muted)]">
          Skills
        </h2>
        {skillsQ.isLoading && (
          <div className="text-sm text-[var(--text-faint)]">loading…</div>
        )}
        {!skillsQ.isLoading && skills.length === 0 && (
          <p className="text-sm text-[var(--text-faint)]">
            No skills yet — add one above.
          </p>
        )}
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-[var(--text-faint)]">
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2">Triggers</th>
              <th className="px-3 py-2">Enabled</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {skills.map((s) => (
              <tr
                key={s.slug}
                className="border-t border-[var(--border)] align-top"
              >
                <td className="px-3 py-2 font-medium text-[var(--text)]">{s.name}</td>
                <td className="px-3 py-2 text-[var(--text-muted)]">{s.description}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {s.triggers.map((t) => (
                      <span
                        key={t}
                        className="rounded-full border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-0.5 font-mono text-[11px] text-[var(--text-muted)]"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <label className="inline-flex items-center gap-2 text-xs text-[var(--text-muted)]">
                    <input
                      type="checkbox"
                      checked={s.enabled}
                      onChange={() => toggleEnabled.mutate(s)}
                    />
                    {s.enabled ? "on" : "off"}
                  </label>
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => {
                      if (confirm(`Delete skill "${s.slug}"?`))
                        remove.mutate(s.slug);
                    }}
                    className="text-xs text-red-600 hover:text-red-300"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
