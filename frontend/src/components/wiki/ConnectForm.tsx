import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "../../lib/api";

type CreateResp = { id: number; name: string; included_tables: string[] | null };

/**
 * Wiki-context source-connect form. Mirrors the legacy
 * src/components/wiki/ConnectForm.tsx. POSTs to /api/connections.
 */
export default function ConnectForm() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", conn_url: "" });
  const [error, setError] = useState<string | null>(null);

  const create = useMutation<CreateResp, Error, { name: string; conn_url: string }>({
    mutationFn: (body) => api.post<CreateResp>("/api/connections", { ...body, kind: "postgres" }),
    onSuccess: () => {
      setForm({ name: "", conn_url: "" });
      setError(null);
      void qc.invalidateQueries({ queryKey: ["connections"] });
      void qc.invalidateQueries({ queryKey: ["wiki", "tree"] });
    },
    onError: (e) => {
      setError(e instanceof ApiError ? `${e.status}: ${e.message}` : e.message);
    },
  });

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!form.name.trim() || !form.conn_url.trim()) return;
        create.mutate(form);
      }}
    >
      <div>
        <label className="block text-xs uppercase tracking-wide text-[var(--text-muted)]">Name</label>
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="factory_demo"
          className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2 text-sm outline-none focus:border-blue-500"
        />
      </div>
      <div>
        <label className="block text-xs uppercase tracking-wide text-[var(--text-muted)]">
          Connection URL
        </label>
        <input
          value={form.conn_url}
          onChange={(e) => setForm({ ...form, conn_url: e.target.value })}
          placeholder="postgres://user:pass@host:5432/db"
          className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2 font-mono text-xs outline-none focus:border-blue-500"
        />
      </div>
      <button
        type="submit"
        disabled={create.isPending || !form.name.trim() || !form.conn_url.trim()}
        className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
      >
        {create.isPending ? "Connecting…" : "Connect"}
      </button>
      {error && <div className="text-xs text-red-600">{error}</div>}
    </form>
  );
}
