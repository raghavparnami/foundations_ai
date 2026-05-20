import { useState } from "react";

/**
 * Doc-upload form. The backend `/api/wiki/upload` route is not ported yet
 * (the doc indexer lands in a later chunk), so this form short-circuits
 * with an informational message.
 */
export default function UploadForm() {
  const [file, setFile] = useState<File | null>(null);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        // Intentional stub — no submit yet.
      }}
    >
      <div>
        <label className="block text-xs uppercase tracking-wide text-[var(--text-muted)]">
          Document
        </label>
        <input
          type="file"
          accept=".md,.pdf,.txt,.docx"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mt-1 block w-full text-xs text-[var(--text-muted)] file:mr-3 file:rounded file:border-0 file:bg-[var(--bg-elev)] file:px-3 file:py-1.5 file:text-xs file:text-[var(--text)] hover:file:bg-white/15"
        />
        {file && (
          <div className="mt-1 text-xs text-[var(--text-faint)]">
            {file.name} · {(file.size / 1024).toFixed(1)} KB
          </div>
        )}
      </div>
      <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        Upload endpoint pending — the doc indexer ports in a later chunk.
        For now, run the legacy app on :3001 to upload, then it'll appear in
        this wiki automatically (both apps share the same catalog).
      </div>
      <button
        type="button"
        disabled
        className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white opacity-40"
      >
        Upload (disabled)
      </button>
    </form>
  );
}
