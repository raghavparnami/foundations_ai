"use client";
import { useEffect, useState } from "react";
import { useActiveProject, ALL_PROJECTS } from "./useActiveProject";

type ProjectSummary = { slug: string; name: string };

export default function ProjectPicker() {
  const [active, setActive] = useActiveProject();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const r = await fetch("/api/projects");
        const j = await r.json();
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

  const activeName =
    active === ALL_PROJECTS
      ? "All data"
      : projects.find((p) => p.slug === active)?.name ?? active;

  return (
    <div className="px-4 py-3 border-b border-[var(--border)]">
      <label className="block text-[10px] uppercase tracking-wider text-[var(--text-faint)] mb-1 font-semibold">
        Project
      </label>
      <div className="relative">
        <select
          value={active}
          onChange={(e) => setActive(e.target.value)}
          className="w-full appearance-none bg-[var(--bg-elev)] border border-[var(--border)] rounded-md px-3 py-1.5 pr-8 text-[13px] font-medium text-[var(--text)] outline-none focus:border-[var(--accent)] cursor-pointer"
        >
          <option value={ALL_PROJECTS}>All data</option>
          {projects.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-faint)] text-[10px]">▾</span>
      </div>
      <p className="text-[10px] text-[var(--text-faint)] mt-1.5 truncate">
        agent scope: <span className="text-[var(--text-muted)]">{activeName}</span>
      </p>
    </div>
  );
}
