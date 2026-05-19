"use client";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Candidate = {
  id: number;
  slug: string;
  name: string;
  description: string;
  triggers: string[];
  body_md: string;
  created_at: string;
};

/**
 * Bottom-right floating card. Polls for pending skill candidates scoped to
 * the current conversation and surfaces the most recent one with Accept /
 * Dismiss / Preview actions.
 */
export default function SkillSuggestion({ conversationId }: { conversationId: string }) {
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false); // local-only "minimize"

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const r = await fetch(`/api/skill-candidates?conversation_id=${encodeURIComponent(conversationId)}`);
        const j = await r.json();
        if (!alive) return;
        const next: Candidate | null = j.candidates?.[0] ?? null;
        setCandidate(next);
        if (next && next.id !== candidate?.id) setHidden(false);
      } catch {
        /* swallow */
      }
    }
    void tick();
    const iv = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [conversationId, candidate?.id]);

  if (!candidate || hidden) return null;

  async function accept() {
    if (!candidate) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/skill-candidates/${candidate.id}`, { method: "POST" });
      if (r.ok) setHidden(true);
    } finally {
      setBusy(false);
    }
  }
  async function dismiss() {
    if (!candidate) return;
    setBusy(true);
    try {
      await fetch(`/api/skill-candidates/${candidate.id}`, { method: "DELETE" });
      setHidden(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Skill suggestion"
      className="fixed bottom-6 right-6 w-[340px] z-30 rounded-2xl border border-[var(--border)] bg-[var(--bg-elev)] shadow-lg overflow-hidden"
      style={{
        boxShadow:
          "0 12px 30px -10px rgba(91,108,255,0.25), 0 4px 12px -2px rgba(20,21,42,0.06)",
      }}
    >
      <div className="px-4 py-2.5 flex items-center justify-between bg-[var(--accent-soft)]">
        <div className="flex items-center gap-2">
          <SparkleIcon />
          <span className="text-[11px] uppercase tracking-wider font-semibold text-[var(--accent)]">
            Loom learned something
          </span>
        </div>
        <button
          onClick={() => setHidden(true)}
          aria-label="Hide"
          className="text-[var(--text-faint)] hover:text-[var(--text)] text-[14px]"
        >
          ×
        </button>
      </div>
      <div className="px-4 py-3">
        <div className="text-[14px] font-semibold text-[var(--text)] mb-0.5">
          Save as a Skill: <span className="text-[var(--accent)]">{candidate.name}</span>
        </div>
        <div className="text-[12px] text-[var(--text-muted)] leading-snug mb-2">
          {candidate.description}
        </div>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {candidate.triggers.slice(0, 6).map((t) => (
            <span
              key={t}
              className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-[var(--border)] text-[var(--text-muted)] bg-[var(--bg-soft)]"
            >
              {t}
            </span>
          ))}
        </div>
        <button
          onClick={() => setShowPreview((v) => !v)}
          className="text-[11px] text-[var(--text-muted)] hover:text-[var(--accent)] mb-3"
        >
          {showPreview ? "Hide playbook ▴" : "Preview playbook ▾"}
        </button>
        {showPreview && (
          <div className="max-h-[200px] overflow-y-auto mb-3 rounded-md border border-[var(--border)] bg-[var(--bg)] p-3 text-[11px] markdown-doc">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{candidate.body_md}</ReactMarkdown>
          </div>
        )}
        <div className="flex items-center gap-2">
          <button
            disabled={busy}
            onClick={accept}
            className="flex-1 text-[12px] font-medium text-white px-3 py-1.5 rounded-md disabled:opacity-40 transition"
            style={{ background: "var(--gradient-hero)" }}
          >
            Add as Skill
          </button>
          <button
            disabled={busy}
            onClick={dismiss}
            className="text-[12px] text-[var(--text-muted)] hover:text-[var(--text)] px-3 py-1.5"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

function SparkleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="text-[var(--accent)]">
      <path d="M12 2v6M12 16v6M2 12h6M16 12h6M5.6 5.6l3.5 3.5M14.9 14.9l3.5 3.5M5.6 18.4l3.5-3.5M14.9 9.1l3.5-3.5" strokeLinecap="round" />
    </svg>
  );
}
