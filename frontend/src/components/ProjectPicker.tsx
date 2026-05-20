import { useEffect, useState } from "react";
import { api } from "../lib/api";

const STORAGE_KEY = "loom.activeProject";
const ALL = "__all__";

type ProjectSummary = { slug: string; name: string };

type ProjectsResponse = {
  projects?: ProjectSummary[];
};

function readSlug(): string {
  if (typeof window === "undefined") return ALL;
  try {
    return localStorage.getItem(STORAGE_KEY) ?? ALL;
  } catch {
    return ALL;
  }
}

function writeSlug(s: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, s);
  } catch {
    /* swallow */
  }
}

/**
 * Dropdown for the active project. Selection is persisted in localStorage
 * under `loom.activeProject`; the list refreshes every 5s.
 */
export default function ProjectPicker() {
  const [active, setActive] = useState<string>(ALL);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);

  useEffect(() => {
    setActive(readSlug());
  }, []);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const j = await api.get<ProjectsResponse>("/api/projects");
        if (!alive) return;
        setProjects(j.projects ?? []);
      } catch {
        /* swallow */
      }
    }
    void tick();
    const iv = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  function onChange(slug: string) {
    setActive(slug);
    writeSlug(slug);
  }

  const activeName =
    active === ALL ? "All data" : projects.find((p) => p.slug === active)?.name ?? active;

  return (
    <div className="px-4 py-3 border-b border-[var(--border)]">
      <label className="block text-[10px] uppercase tracking-wider text-[var(--text-faint)] mb-1 font-semibold">
        Project
      </label>
      <div className="relative">
        <select
          value={active}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none bg-[var(--bg-soft)] border border-[var(--border)] rounded-md px-3 py-1.5 pr-8 text-[13px] font-medium text-[var(--text)] outline-none focus:border-white/30 cursor-pointer"
        >
          <option value={ALL}>All data</option>
          {projects.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name}
            </option>
          ))}
        </select>
        <span
          aria-hidden
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-faint)] text-[10px]"
        >
          ▾
        </span>
      </div>
      <p className="text-[10px] text-[var(--text-faint)] mt-1.5 truncate">
        agent scope: <span className="text-[var(--text-muted)]">{activeName}</span>
      </p>
    </div>
  );
}
