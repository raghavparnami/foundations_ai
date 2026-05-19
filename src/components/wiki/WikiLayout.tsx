"use client";
import { useEffect, useState } from "react";
import WikiTree from "./WikiTree";
import type { TreeDomain } from "./types";

/**
 * Outer 3-column wiki layout (left tree · main · right rail).
 * The right rail is owned by the page renderer (TOC + metadata + backlinks),
 * so this component only owns the left rail. The center renders `children`.
 */
export default function WikiLayout({
  activeSlug,
  children,
}: {
  activeSlug: string | null;
  children: React.ReactNode;
}) {
  const [tree, setTree] = useState<TreeDomain[]>([]);
  const [unassigned, setUnassigned] = useState<{ slug: string; title: string; corpus: string | null }[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const r = await fetch("/api/wiki/tree");
        const j = await r.json();
        if (!alive) return;
        setTree(j.domains ?? []);
        setUnassigned(j.unassigned ?? []);
      } catch {
        // swallow
      }
    }
    void tick();
    const iv = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  const filtered = filterTree(tree, q);

  return (
    <div className="flex flex-1 min-h-0">
      <aside className="w-[260px] shrink-0 border-r border-[var(--border)] bg-[var(--bg-soft)] flex flex-col">
        <div className="px-4 py-3 border-b border-[var(--border)]">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the wiki…"
            className="w-full bg-[var(--bg-elev)] border border-[var(--border)] rounded-md px-3 py-1.5 text-[12px] outline-none focus:border-[var(--accent)]"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-3">
          <div className="px-2 mb-2 text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold flex items-center justify-between">
            <span>Domains</span>
            <span className="text-[9px] normal-case font-normal tracking-normal" title="Domains are auto-discovered by the LLM from your tables, docs, code, and skills. They cut across corpus types so 'Quality' includes the deviations table AND a QA runbook PDF.">
              what's this?
            </span>
          </div>
          <WikiTree tree={filtered} activeSlug={activeSlug} />

          {unassigned.length > 0 && (
            <div className="mt-6">
              <div className="px-2 mb-2 text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold">
                Unassigned ({unassigned.length})
              </div>
              <ul className="space-y-0.5">
                {unassigned.map((p) => (
                  <li key={p.slug}>
                    <a
                      href={`/wiki/${p.slug}`}
                      className="block px-2 py-1 rounded-md text-[12px] text-[var(--text-muted)] hover:bg-[var(--bg-elev)] hover:text-[var(--text)] truncate"
                    >
                      {p.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="border-t border-[var(--border)] px-4 py-3">
          <a
            href="/connections"
            className="block px-3 py-2 rounded-md text-[12px] text-[var(--text-muted)] hover:bg-[var(--bg-elev)] hover:text-[var(--accent)] border border-[var(--border)] text-center transition"
          >
            Manage sources →
          </a>
          <p className="mt-3 px-1 text-[10px] text-[var(--text-faint)] leading-relaxed">
            Add databases, upload documents, or connect repos from Connections.
            Pages auto-update every 60s.
          </p>
        </div>
      </aside>
      <main className="flex-1 min-w-0 flex">{children}</main>
    </div>
  );
}

function filterTree(tree: TreeDomain[], q: string): TreeDomain[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return tree;
  return tree
    .map((d) => {
      const matchesDomain = d.name.toLowerCase().includes(needle) || (d.description ?? "").toLowerCase().includes(needle);
      const pages = d.pages.filter(
        (p) => p.title.toLowerCase().includes(needle) || (p.summary ?? "").toLowerCase().includes(needle),
      );
      if (matchesDomain) return d;
      if (pages.length > 0) return { ...d, pages };
      return null;
    })
    .filter((d): d is TreeDomain => d !== null);
}
