import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";

type MemoryScope = "user" | "workspace";
type MemoryKind = "preference" | "fact" | "rule" | "glossary" | "other";

type Memory = {
  id: number;
  scope: MemoryScope;
  kind: MemoryKind;
  content: string;
  importance: number;
  source: string;
  conversation_id: string | null;
  use_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

type MemoriesResp = { memories: Memory[] };

const SCOPES: MemoryScope[] = ["user", "workspace"];
const KINDS: MemoryKind[] = ["preference", "fact", "rule", "glossary", "other"];
type ScopeFilter = "all" | MemoryScope;

type NewMemoryForm = {
  scope: MemoryScope;
  kind: MemoryKind;
  content: string;
  importance: number;
};

const EMPTY_FORM: NewMemoryForm = {
  scope: "user",
  kind: "preference",
  content: "",
  importance: 3,
};

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

export default function Memory() {
  const qc = useQueryClient();
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [form, setForm] = useState<NewMemoryForm>(EMPTY_FORM);

  const memoriesQ = useQuery<MemoriesResp>({
    queryKey: ["memories", scopeFilter],
    queryFn: () =>
      api.get<MemoriesResp>(
        scopeFilter === "all"
          ? "/api/memories"
          : `/api/memories?scope=${scopeFilter}`,
      ),
    refetchInterval: 4_000,
  });

  const create = useMutation({
    mutationFn: (body: NewMemoryForm) => api.post("/api/memories", body),
    onSuccess: () => {
      setForm(EMPTY_FORM);
      void qc.invalidateQueries({ queryKey: ["memories"] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/api/memories/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["memories"] }),
  });

  const memories = memoriesQ.data?.memories ?? [];

  return (
    <div className="h-full overflow-auto p-8">
      <h1 className="text-2xl font-semibold">Memory</h1>
      <p className="mt-2 max-w-xl text-[var(--text-muted)]">
        Durable facts, rules, and preferences the agent loads into every
        relevant chat.
      </p>

      <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--bg-soft)] p-5">
        <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--text-muted)]">
          New memory
        </h2>
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.content.trim()) return;
            create.mutate(form);
          }}
        >
          <textarea
            placeholder="e.g. Always group deviation analysis by production line first."
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            rows={3}
            className="w-full rounded border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-[var(--text-faint)]">
                Scope
              </span>
              <select
                value={form.scope}
                onChange={(e) =>
                  setForm({ ...form, scope: e.target.value as MemoryScope })
                }
                className="rounded border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-1 text-sm"
              >
                {SCOPES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-[var(--text-faint)]">
                Kind
              </span>
              <select
                value={form.kind}
                onChange={(e) =>
                  setForm({ ...form, kind: e.target.value as MemoryKind })
                }
                className="rounded border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-1 text-sm"
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-[var(--text-faint)]">
                Importance {form.importance}
              </span>
              <input
                type="range"
                min={1}
                max={5}
                value={form.importance}
                onChange={(e) =>
                  setForm({ ...form, importance: Number(e.target.value) })
                }
              />
            </label>
            <button
              type="submit"
              disabled={create.isPending || !form.content.trim()}
              className="ml-auto rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {create.isPending ? "Saving…" : "Save memory"}
            </button>
          </div>
          {create.isError && (
            <div className="text-sm text-red-600">
              {(create.error as Error).message}
            </div>
          )}
        </form>
      </section>

      <div className="mt-6 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs uppercase tracking-wide text-[var(--text-faint)]">
          Filter
        </span>
        {(["all", ...SCOPES] as const).map((s) => (
          <button
            key={s}
            onClick={() => setScopeFilter(s)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              scopeFilter === s
                ? "border-blue-500 bg-blue-500/20 text-[var(--text)]"
                : "border-[var(--border)] bg-[var(--bg-soft)] text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            {s}
          </button>
        ))}
        <span className="ml-auto text-xs text-[var(--text-faint)]">
          {memories.length} {memories.length === 1 ? "memory" : "memories"}
        </span>
      </div>

      <section className="mt-3">
        {memoriesQ.isLoading && (
          <div className="text-sm text-[var(--text-faint)]">loading…</div>
        )}
        {!memoriesQ.isLoading && memories.length === 0 && (
          <p className="text-sm text-[var(--text-faint)]">
            No memories yet. The agent can save them via the{" "}
            <code className="text-[var(--text-muted)]">remember</code> tool, or you can
            add one above.
          </p>
        )}
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-[var(--text-faint)]">
              <th className="px-3 py-2">Content</th>
              <th className="px-3 py-2">Kind</th>
              <th className="px-3 py-2">Scope</th>
              <th className="px-3 py-2">Importance</th>
              <th className="px-3 py-2">Last used</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {memories.map((m) => (
              <tr
                key={m.id}
                className="border-t border-[var(--border)] align-top"
              >
                <td className="px-3 py-2 text-[var(--text)]">{m.content}</td>
                <td className="px-3 py-2 text-[var(--text-muted)]">{m.kind}</td>
                <td className="px-3 py-2 text-[var(--text-muted)]">{m.scope}</td>
                <td className="px-3 py-2 font-mono text-[var(--text-muted)]">
                  {m.importance}/5
                </td>
                <td className="px-3 py-2 text-[var(--text-faint)]">
                  {relTime(m.last_used_at) ||
                    `created ${relTime(m.created_at)}`}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-[var(--text-faint)]">
                  {m.source}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => {
                      if (confirm("Delete this memory?"))
                        remove.mutate(m.id);
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
