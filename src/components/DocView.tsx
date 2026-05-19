"use client";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function DocView({
  tableId,
  onClose,
}: {
  tableId: number;
  onClose: () => void;
}) {
  const [md, setMd] = useState<string>("");
  const [prov, setProv] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const r = await fetch(`/api/doc/${tableId}`);
        if (!r.ok) return;
        const j = await r.json();
        if (!alive) return;
        setMd(j.markdown ?? "");
        setProv(j.provenance ?? {});
        setLoading(false);
      } catch {
        // swallow
      }
    }
    void tick();
    const iv = setInterval(tick, 1500);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [tableId]);

  return (
    <div className="flex flex-col h-full bg-[var(--bg-soft)]">
      <div className="px-5 py-3 border-b border-[var(--border)] flex items-center justify-between bg-[var(--bg-elev)]">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text)] text-sm"
            aria-label="Back"
          >
            ← back
          </button>
          <h2 className="text-sm font-semibold text-[var(--text)]">Generated doc</h2>
        </div>
        <ProvenancePills counts={prov} />
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4 bg-[var(--bg-elev)]">
        {loading ? (
          <div className="text-[12px] text-[var(--text-muted)]">loading…</div>
        ) : (
          <div className="markdown-doc text-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {stripProvenanceComments(md)}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

function stripProvenanceComments(md: string): string {
  return md.replace(/<!--\s*provenance:[^>]*-->\n?/g, "");
}

function ProvenancePills({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts).filter(([, v]) => v > 0);
  if (entries.length === 0) return null;
  const cls: Record<string, string> = {
    schema: "prov-schema",
    "query-log": "prov-query",
    claude: "prov-claude",
    human: "prov-human",
  };
  return (
    <div className="flex items-center gap-2 text-[11px]">
      {entries.map(([k, v]) => (
        <span key={k} className={cls[k] ?? "text-[var(--text-muted)]"}>
          ● {k} ({v})
        </span>
      ))}
    </div>
  );
}
