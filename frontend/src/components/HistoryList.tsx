import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";

type Convo = {
  id: string;
  title: string;
  project_slug: string | null;
  last_ts: string;
  turns: number;
};

export default function HistoryList() {
  const [convos, setConvos] = useState<Convo[]>([]);
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const location = useLocation();
  const currentSlug = sp.get("c");

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const r = await fetch("/api/conversations");
        const j = await r.json();
        if (!alive) return;
        setConvos(j.conversations ?? []);
      } catch {
        /* swallow */
      }
    }
    void tick();
    const iv = setInterval(tick, 4000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  function newChat() {
    const fresh =
      "c-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    navigate(`/?c=${fresh}`);
  }

  function open(c: Convo) {
    if (location.pathname === "/") {
      navigate(`/?c=${c.id}`, { replace: true });
    } else {
      navigate(`/?c=${c.id}`);
    }
  }

  const groups = groupByDay(convos);

  return (
    <div className="px-2 pb-3 flex-1 overflow-y-auto">
      <div className="flex items-center justify-between px-3 mt-3 mb-1">
        <span className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold">
          History
        </span>
        <button
          onClick={newChat}
          title="Start a new conversation"
          className="text-[11px] text-[var(--text-muted)] hover:text-[var(--accent)] flex items-center gap-1"
        >
          <PlusIcon />
          New
        </button>
      </div>
      {convos.length === 0 ? (
        <div className="px-3 py-3 text-[11px] text-[var(--text-faint)]">
          No conversations yet. Start one in Chat.
        </div>
      ) : (
        groups.map(({ label, items }) => (
          <div key={label} className="mb-2">
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] px-3 mt-2 mb-1">
              {label}
            </div>
            <ul>
              {items.map((c) => {
                const active = c.id === currentSlug && location.pathname === "/";
                return (
                  <li key={c.id}>
                    <button
                      title={c.title}
                      onClick={() => open(c)}
                      className={`w-full text-left px-3 py-1.5 rounded-md text-[12px] truncate transition ${
                        active
                          ? "bg-[var(--bg-elev)] text-[var(--text)] border border-[var(--border)]"
                          : "text-[var(--text-muted)] hover:bg-[var(--bg-elev)] hover:text-[var(--text)]"
                      }`}
                    >
                      {c.title || c.id}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}

function PlusIcon() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function groupByDay(convos: Convo[]): { label: string; items: Convo[] }[] {
  const today: Convo[] = [];
  const yesterday: Convo[] = [];
  const week: Convo[] = [];
  const older: Convo[] = [];
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  for (const c of convos) {
    const t = new Date(c.last_ts).getTime();
    const age = now - t;
    if (age < day) today.push(c);
    else if (age < 2 * day) yesterday.push(c);
    else if (age < 7 * day) week.push(c);
    else older.push(c);
  }
  const out: { label: string; items: Convo[] }[] = [];
  if (today.length) out.push({ label: "Today", items: today });
  if (yesterday.length) out.push({ label: "Yesterday", items: yesterday });
  if (week.length) out.push({ label: "Last 7 days", items: week });
  if (older.length) out.push({ label: "Older", items: older });
  return out;
}
