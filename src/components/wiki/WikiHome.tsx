"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { TreeDomain } from "./types";

type LogEntry = {
  ts: string;
  kind: string;
  target_kind: string | null;
  target_slug: string | null;
  domain_slug: string | null;
  summary: string;
};

export default function WikiHome() {
  const [tree, setTree] = useState<TreeDomain[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const [t, l] = await Promise.all([
          fetch("/api/wiki/tree").then((r) => r.json()),
          fetch("/api/wiki/log?limit=10").then((r) => r.json()),
        ]);
        if (!alive) return;
        setTree(t.domains ?? []);
        setLog(l.entries ?? []);
      } catch {
        // swallow
      }
    }
    void load();
    const iv = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  const totalPages = tree.reduce((acc, d) => acc + d.page_count, 0);

  return (
    <div className="flex-1 min-w-0 overflow-y-auto px-12 py-10 bg-[var(--bg-elev)]">
      <header className="pb-6 mb-8 border-b border-[var(--border)]">
        <h1 className="text-[28px] font-semibold tracking-tight leading-tight">Wiki</h1>
        <p className="mt-2 text-[14px] text-[var(--text-muted)] max-w-2xl">
          The LLM-curated knowledge base for your data. Tables, documents, and
          code organized into domains your team would recognize — synthesized,
          not just dumped.
        </p>
        <div className="mt-3 flex items-center gap-4 text-[12px] text-[var(--text-faint)]">
          <span>
            <strong className="text-[var(--text)]">{tree.length}</strong> domains
          </span>
          <span>·</span>
          <span>
            <strong className="text-[var(--text)]">{totalPages}</strong> pages
          </span>
          <span>·</span>
          <span>updated continuously by 4 agents</span>
        </div>
      </header>

      {tree.length === 0 ? (
        <div className="px-6 py-12 text-center border border-dashed border-[var(--border)] rounded-lg">
          <p className="text-[14px] text-[var(--text-muted)]">
            The wiki is being assembled. Domains appear within ~60s of the first source landing in the catalog.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {tree.map((d) => (
            <Link
              key={d.slug}
              href={d.index_slug ? `/wiki/${d.index_slug}` : "/wiki"}
              className="block rounded-lg border border-[var(--border)] bg-[var(--bg)] hover:border-[var(--accent)] hover:shadow-sm transition p-5 group"
            >
              <div className="flex items-start gap-3">
                <span
                  aria-hidden
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 4,
                    background: d.color || "var(--accent)",
                    marginTop: 4,
                    flexShrink: 0,
                  }}
                />
                <div className="flex-1 min-w-0">
                  <h2 className="text-[16px] font-semibold text-[var(--text)] group-hover:text-[var(--accent)]">
                    {d.name}
                  </h2>
                  {d.description && (
                    <p className="mt-1 text-[12px] text-[var(--text-muted)] line-clamp-2 leading-relaxed">
                      {d.description}
                    </p>
                  )}
                  <div className="mt-3 flex items-center gap-3 text-[11px] text-[var(--text-faint)]">
                    <span>{d.page_count} pages</span>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {log.length > 0 && (
        <section className="mt-12">
          <h3 className="text-[14px] font-semibold mb-3">Recent activity</h3>
          <ul className="border border-[var(--border)] rounded-lg divide-y divide-[var(--border)] overflow-hidden">
            {log.map((e, i) => (
              <li key={i} className="px-4 py-2 text-[12px] flex items-center gap-3">
                <span className="text-[var(--text-faint)] font-mono text-[10px]">
                  {e.ts.slice(0, 16).replace("T", " ")}
                </span>
                <span className="text-[10px] uppercase tracking-wider font-semibold text-[var(--accent)] w-12 shrink-0">
                  {e.kind}
                </span>
                <span className="flex-1 text-[var(--text-muted)] truncate">
                  {e.summary}
                </span>
                {e.target_slug && (
                  <Link
                    href={`/wiki/${e.target_slug}`}
                    className="text-[var(--accent)] hover:underline text-[11px] shrink-0"
                  >
                    view →
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
