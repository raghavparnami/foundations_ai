import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../lib/api";

type DocResponse = {
  markdown?: string;
  provenance?: Record<string, number>;
};

type ProvKey = "schema" | "query-log" | "claude" | "human";

type Block = {
  prov: ProvKey | null;
  body: string;
};

/**
 * Renders the markdown doc for a single table. Each paragraph is wrapped in
 * a left-border block coloured by its provenance comment so the user can see
 * at a glance which lines came from the schema, the query log, the LLM, or
 * a human edit.
 */
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
        const j = await api.get<DocResponse>(`/api/catalog/doc/${tableId}`);
        if (!alive) return;
        setMd(j.markdown ?? "");
        setProv(j.provenance ?? {});
        setLoading(false);
      } catch {
        /* swallow */
      }
    }
    void tick();
    const iv = setInterval(tick, 1500);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [tableId]);

  const blocks = splitByProvenance(md);

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-3 border-b border-[var(--border)] flex items-center justify-between bg-[var(--bg-soft)]">
        <div className="flex items-center gap-3">
          <button
            type="button"
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
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {loading ? (
          <div className="text-[12px] text-[var(--text-muted)]">loading…</div>
        ) : (
          <div className="space-y-3 text-sm text-[var(--text)]/90">
            {blocks.map((b, i) => (
              <ProvBlock key={i} block={b} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProvBlock({ block }: { block: Block }) {
  const borderCls = block.prov ? PROV_BORDER[block.prov] : "border-[var(--border)]";
  return (
    <div
      className={`border-l-2 ${borderCls} pl-3 prose prose prose-sm max-w-none [&_pre]:bg-[var(--bg-soft)] [&_code]:text-[var(--text)]/90`}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.body}</ReactMarkdown>
    </div>
  );
}

const PROV_BORDER: Record<ProvKey, string> = {
  schema: "border-provenance-schema",
  "query-log": "border-provenance-query",
  claude: "border-provenance-claude",
  human: "border-provenance-human",
};

const PROV_TEXT: Record<ProvKey, string> = {
  schema: "text-provenance-schema",
  "query-log": "text-provenance-query",
  claude: "text-provenance-claude",
  human: "text-provenance-human",
};

const PROV_RE = /<!--\s*provenance:\s*([a-z-]+)\s*-->/gi;

function splitByProvenance(md: string): Block[] {
  if (!md) return [];
  const blocks: Block[] = [];
  let lastIdx = 0;
  let currentProv: ProvKey | null = null;
  PROV_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PROV_RE.exec(md)) !== null) {
    const before = md.slice(lastIdx, match.index).trim();
    if (before) blocks.push({ prov: currentProv, body: before });
    const tag = (match[1] ?? "").toLowerCase();
    currentProv = isProvKey(tag) ? tag : null;
    lastIdx = match.index + match[0].length;
  }
  const tail = md.slice(lastIdx).trim();
  if (tail) blocks.push({ prov: currentProv, body: tail });
  return blocks;
}

function isProvKey(s: string): s is ProvKey {
  return s === "schema" || s === "query-log" || s === "claude" || s === "human";
}

function ProvenancePills({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts).filter(([, v]) => v > 0);
  if (entries.length === 0) return null;
  return (
    <div className="flex items-center gap-2 text-[11px]">
      {entries.map(([k, v]) => {
        const key = isProvKey(k) ? k : null;
        const cls = key ? PROV_TEXT[key] : "text-[var(--text-muted)]";
        return (
          <span key={k} className={cls}>
            ● {k} ({v})
          </span>
        );
      })}
    </div>
  );
}
