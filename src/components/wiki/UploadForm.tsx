"use client";
import { useEffect, useState } from "react";

type Doc = {
  id: number;
  display_name: string;
  mime: string;
  size_bytes: number;
  status: string;
  uploaded_at: string;
  indexed_at: string | null;
};

export default function UploadForm() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);

  async function refresh() {
    try {
      const r = await fetch("/api/wiki/upload");
      const j = await r.json();
      setDocs(j.documents ?? []);
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
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/wiki/upload", { method: "POST", body: fd });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setMsg(`Error: ${j.error ?? r.statusText}`);
      } else {
        setMsg(`Uploaded "${file.name}". The docs-wiki agent will index it shortly.`);
        setFile(null);
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-8">
      <form onSubmit={submit} className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-6">
        <label className="block">
          <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] mb-2 font-semibold">
            File
          </div>
          <input
            type="file"
            accept=".pdf,.docx,.md,.markdown,.txt,.text"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-[13px] file:mr-3 file:px-3 file:py-1.5 file:rounded-md file:border-0 file:bg-[var(--accent-soft)] file:text-[var(--accent)] file:cursor-pointer file:font-medium"
          />
          <p className="mt-2 text-[11px] text-[var(--text-faint)]">
            Max 20 MB. PDF, DOCX, Markdown, or plain text.
          </p>
        </label>
        <div className="mt-5 flex items-center gap-3">
          <button
            type="submit"
            disabled={busy || !file}
            className="bg-[var(--accent)] text-white text-[13px] font-medium px-4 py-2 rounded-md hover:bg-indigo-600 disabled:opacity-40 transition"
          >
            {busy ? "Uploading…" : "Upload"}
          </button>
          {msg && <span className="text-[12px] text-[var(--text-muted)]">{msg}</span>}
        </div>
      </form>

      <section>
        <h2 className="text-[14px] font-semibold mb-3">Previously uploaded ({docs.length})</h2>
        {docs.length === 0 ? (
          <div className="px-4 py-8 text-center text-[12px] text-[var(--text-muted)] border border-dashed border-[var(--border)] rounded-lg">
            No documents yet. Drop one above.
          </div>
        ) : (
          <ul className="border border-[var(--border)] rounded-lg divide-y divide-[var(--border)] overflow-hidden">
            {docs.map((d) => (
              <li key={d.id} className="px-4 py-3 flex items-center gap-4 text-[12px]">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: d.status === "indexed" ? "#10b981" : d.status === "failed" ? "#ef4444" : "#fbbf24" }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[var(--text)] font-medium truncate">{d.display_name}</div>
                  <div className="text-[10px] text-[var(--text-faint)] font-mono">
                    {d.mime} · {fmtBytes(d.size_bytes)} · {d.status} · uploaded {fmtTime(d.uploaded_at)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function fmtTime(iso: string): string {
  return iso.slice(0, 16).replace("T", " ");
}
