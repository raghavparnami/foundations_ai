import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { LogResponse, TreeResponse } from "./types";

/**
 * Landing pane for /wiki. Shows domain cards + a small recent-activity log.
 */
export default function WikiHome() {
  const tree = useQuery<TreeResponse>({
    queryKey: ["wiki", "tree"],
    queryFn: () => api.get<TreeResponse>("/api/wiki/tree"),
    refetchInterval: 5_000,
  });
  const log = useQuery<LogResponse>({
    queryKey: ["wiki", "log"],
    queryFn: () => api.get<LogResponse>("/api/wiki/log?limit=10"),
    refetchInterval: 5_000,
  });

  const domains = tree.data?.domains ?? [];
  const entries = log.data?.entries ?? [];
  const totalPages = domains.reduce((acc, d) => acc + d.page_count, 0);

  return (
    <div className="flex-1 min-w-0 overflow-y-auto bg-[var(--bg-soft)] px-12 py-10">
      <header className="mb-8 border-b border-[var(--border)] pb-6">
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-[var(--text)]">
          Wiki
        </h1>
        <p className="mt-2 max-w-2xl text-[14px] text-[var(--text-muted)]">
          The LLM-curated knowledge base for your data. Tables, documents, and
          code organized into domains your team would recognize — synthesized,
          not just dumped.
        </p>
        <div className="mt-3 flex items-center gap-4 text-[12px] text-[var(--text-faint)]">
          <span>
            <strong className="text-[var(--text)]">{domains.length}</strong> domains
          </span>
          <span>·</span>
          <span>
            <strong className="text-[var(--text)]">{totalPages}</strong> pages
          </span>
          <span>·</span>
          <span>updated continuously by background agents</span>
        </div>
      </header>

      {domains.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border)] px-6 py-12 text-center">
          <p className="text-[14px] text-[var(--text-muted)]">
            The wiki is being assembled. Domains appear within ~60s of the first
            source landing in the catalog.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {domains.map((d) => (
            <Link
              key={d.slug}
              to={d.index_slug ? `/wiki/${d.index_slug}` : "/wiki"}
              className="group block rounded-lg border border-[var(--border)] bg-[var(--bg-soft)] p-5 transition hover:border-blue-500 hover:bg-[var(--bg-elev)]"
            >
              <div className="flex items-start gap-3">
                <span
                  aria-hidden
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 4,
                    background: d.color || "#3b82f6",
                    marginTop: 4,
                    flexShrink: 0,
                  }}
                />
                <div className="min-w-0 flex-1">
                  <h2 className="text-[16px] font-semibold text-[var(--text)] group-hover:text-[var(--accent)]">
                    {d.name}
                  </h2>
                  {d.description && (
                    <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-[var(--text-muted)]">
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

      {entries.length > 0 && (
        <section className="mt-12">
          <h3 className="mb-3 text-[14px] font-semibold text-[var(--text)]">Recent activity</h3>
          <ul className="divide-y divide-white/10 overflow-hidden rounded-lg border border-[var(--border)]">
            {entries.map((e, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-2 text-[12px]">
                <span className="font-mono text-[10px] text-[var(--text-faint)]">
                  {e.ts.slice(0, 16).replace("T", " ")}
                </span>
                <span className="w-12 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)]">
                  {e.kind}
                </span>
                <span className="flex-1 truncate text-[var(--text-muted)]">{e.summary}</span>
                {e.target_slug && (
                  <Link
                    to={`/wiki/${e.target_slug}`}
                    className="shrink-0 text-[11px] text-blue-400 hover:underline"
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
