/**
 * Tiny "recent activity" feed for one SME — pulled lazily when the user
 * opens the disclosure on the card. Read-only.
 *
 * Backend: GET /api/sme/<sme_id>/activity
 */
import { useEffect, useState } from "react";
import { api } from "../../lib/api";

type ActivityItem = {
  kind: "meeting" | "rated" | "taught" | "distilled";
  ts: string;
  detail: string;
};

type Props = { smeId: string; accent: string };

const KIND_LABEL: Record<string, string> = {
  meeting: "Convened",
  rated: "Rated",
  taught: "Taught",
  distilled: "Distilled",
};

export default function ActivityDrawer({ smeId, accent }: Props) {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.get<{ items: ActivityItem[] }>(
          `/api/sme/${smeId}/activity`,
        );
        if (alive) setItems(r.items ?? []);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [smeId]);

  if (error) {
    return <div className="text-[10.5px] text-red-500 mt-1">{error}</div>;
  }
  if (items === null) {
    return (
      <div className="text-[10.5px] text-[var(--text-faint)] italic mt-1">
        loading activity…
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="text-[10.5px] text-[var(--text-faint)] italic mt-1">
        No activity yet. Convene this SME or teach it something.
      </div>
    );
  }

  return (
    <ul className="mt-1.5 space-y-1.5 max-h-[160px] overflow-y-auto pr-1">
      {items.map((it, i) => (
        <li key={i} className="flex items-start gap-2">
          <span
            aria-hidden
            className="inline-block w-1 h-1 rounded-full mt-1.5 shrink-0"
            style={{ background: accent }}
          />
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] text-[var(--text-muted)] flex items-center gap-1.5">
              <span
                className="text-[9px] uppercase tracking-wider font-medium"
                style={{ color: accent }}
              >
                {KIND_LABEL[it.kind] ?? it.kind}
              </span>
              <span className="text-[var(--text-faint)]">{relTime(it.ts)}</span>
            </div>
            <div className="text-[11px] text-[var(--text)] mt-0.5 leading-snug">
              {it.detail}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.max(1, Math.floor(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
