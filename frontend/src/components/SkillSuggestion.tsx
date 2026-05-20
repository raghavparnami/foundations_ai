import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";

type Candidate = {
  id: number;
  slug: string;
  name: string;
  description: string;
  triggers: string[];
  body_md: string;
  created_at: string;
};

type CandidatesResponse = {
  candidates?: Candidate[];
};

/**
 * In-chat card surfacing the most recent pending skill candidate for the
 * current conversation. Polls every 3s; offers Accept / Dismiss actions.
 */
export default function SkillSuggestion({ conversationId }: { conversationId: string }) {
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const j = await api.get<CandidatesResponse>(
          `/api/skill-candidates?conversation_id=${encodeURIComponent(conversationId)}`,
        );
        if (!alive) return;
        const next = j.candidates?.[0] ?? null;
        setCandidate((prev) => {
          if (next && next.id !== prev?.id) setHidden(false);
          return next;
        });
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
  }, [conversationId]);

  if (!candidate || hidden) return null;

  async function accept() {
    if (!candidate) return;
    setBusy(true);
    try {
      await api.post(`/api/skill-candidates/${candidate.id}`);
      setHidden(true);
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
    } finally {
      setBusy(false);
    }
  }

  async function dismiss() {
    if (!candidate) return;
    setBusy(true);
    try {
      await api.delete(`/api/skill-candidates/${candidate.id}`);
      setHidden(true);
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Skill suggestion"
      className="rounded-xl border border-[var(--border)] bg-[var(--bg-soft)] px-4 py-3 my-2"
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-muted)]">
          Loom learned something
        </span>
        <button
          type="button"
          onClick={() => setHidden(true)}
          aria-label="Hide"
          className="text-[var(--text-faint)] hover:text-[var(--text)] text-[14px] leading-none"
        >
          ×
        </button>
      </div>
      <div className="text-[14px] font-semibold text-[var(--text)] mb-0.5">
        Save as a Skill: <span className="text-[var(--text)]">{candidate.name}</span>
      </div>
      <div className="text-[12px] text-[var(--text-muted)] leading-snug mb-2">
        {candidate.description}
      </div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {candidate.triggers.slice(0, 6).map((t) => (
          <span
            key={t}
            className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-[var(--border)] text-[var(--text-muted)]"
          >
            {t}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={accept}
          className="flex-1 text-[12px] font-medium text-[var(--text)] bg-[var(--bg-elev)] hover:bg-white/20 border border-[var(--border)] px-3 py-1.5 rounded-md disabled:opacity-40 transition"
        >
          Accept
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={dismiss}
          className="text-[12px] text-[var(--text-muted)] hover:text-[var(--text)] px-3 py-1.5 disabled:opacity-40"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
