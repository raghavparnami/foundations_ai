import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { TreeDomain, TreePage, TreeResponse } from "./types";

type CorpusKey = "data" | "code" | "docs";

const CORPUS_META: Record<
  CorpusKey,
  {
    label: string;
    description: string;
    emptyHint: { text: string; href: string } | null;
    matches: (corpus: string | null) => boolean;
  }
> = {
  data: {
    label: "Data",
    description: "Tables and saved views from the connected database",
    emptyHint: null,
    matches: (c) => c === "tables" || c === "views" || c === "mixed" || c === null,
  },
  code: {
    label: "GitLab",
    description: "Source repositories indexed by module",
    emptyHint: { text: "Connect a repository ↗", href: "/wiki/connect" },
    matches: (c) => c === "code",
  },
  docs: {
    label: "Business documents",
    description: "Uploaded PDFs, runbooks, and SOPs",
    emptyHint: { text: "Upload a document ↗", href: "/wiki/upload" },
    matches: (c) => c === "documents",
  },
};

const CORPUS_ORDER: CorpusKey[] = ["data", "code", "docs"];

type BucketedDomain = {
  slug: string;
  name: string;
  description: string | null;
  color: string | null;
  index_slug: string | null;
  pages: TreePage[];
};

/**
 * Left sidebar of the wiki. Reads /api/wiki/tree, filters by a search box,
 * and renders a three-tier collapsible nav: Corpus -> Domain -> Page.
 */
export default function WikiSidebar({ activeSlug }: { activeSlug: string | null }) {
  const tree = useQuery<TreeResponse>({
    queryKey: ["wiki", "tree"],
    queryFn: () => api.get<TreeResponse>("/api/wiki/tree"),
    refetchInterval: 5_000,
  });

  const [q, setQ] = useState("");

  const domains = tree.data?.domains ?? [];
  const unassigned = tree.data?.unassigned ?? [];

  const filtered = useMemo(() => filterTree(domains, q), [domains, q]);
  const byCorpus = useMemo(() => bucketByCorpus(filtered), [filtered]);

  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-soft)]">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search the wiki…"
          className="w-full rounded-md border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-1.5 text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)] focus:border-blue-500"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-3">
        <div className="mb-2 flex items-center justify-between px-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
          <span>Domains</span>
          <span
            className="text-[9px] font-normal normal-case tracking-normal"
            title="Domains are auto-discovered by the LLM from your tables, docs, code, and skills."
          >
            what's this?
          </span>
        </div>

        {domains.length === 0 ? (
          <div className="px-2 py-3 text-[11px] text-[var(--text-faint)]">
            No domains yet. The wiki is being assembled.
          </div>
        ) : (
          <CorpusNav byCorpus={byCorpus} activeSlug={activeSlug} />
        )}

        {unassigned.length > 0 && (
          <div className="mt-6">
            <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
              Unassigned ({unassigned.length})
            </div>
            <ul className="space-y-0.5">
              {unassigned.map((p) => (
                <li key={p.slug}>
                  <Link
                    to={`/wiki/${p.slug}`}
                    className="block truncate rounded-md px-2 py-1 text-[12px] text-[var(--text-muted)] hover:bg-[var(--bg-elev)] hover:text-[var(--text)]"
                  >
                    {p.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="border-t border-[var(--border)] px-4 py-3">
        <Link
          to="/connections"
          className="block rounded-md border border-[var(--border)] px-3 py-2 text-center text-[12px] text-[var(--text-muted)] transition hover:bg-[var(--bg-elev)] hover:text-[var(--text)]"
        >
          Manage sources →
        </Link>
        <p className="mt-3 px-1 text-[10px] leading-relaxed text-[var(--text-faint)]">
          Add databases, upload documents, or connect repos from Connections.
          Pages auto-update every 60s.
        </p>
      </div>
    </aside>
  );
}

function CorpusNav({
  byCorpus,
  activeSlug,
}: {
  byCorpus: Record<CorpusKey, BucketedDomain[]>;
  activeSlug: string | null;
}) {
  const [openCorpora, setOpenCorpora] = useState<Set<CorpusKey>>(() => {
    const next = new Set<CorpusKey>();
    next.add("data");
    for (const ck of CORPUS_ORDER) {
      const buckets = byCorpus[ck];
      if (
        buckets.some(
          (b) => b.index_slug === activeSlug || b.pages.some((p) => p.slug === activeSlug),
        )
      ) {
        next.add(ck);
      }
    }
    return next;
  });

  const [openDomains, setOpenDomains] = useState<Set<string>>(() => {
    const next = new Set<string>();
    for (const ck of CORPUS_ORDER) {
      for (const b of byCorpus[ck]) {
        if (
          b.index_slug === activeSlug ||
          b.pages.some((p) => p.slug === activeSlug)
        ) {
          next.add(`${ck}:${b.slug}`);
        }
      }
    }
    return next;
  });

  function toggleCorpus(ck: CorpusKey) {
    const next = new Set(openCorpora);
    if (next.has(ck)) next.delete(ck);
    else next.add(ck);
    setOpenCorpora(next);
  }
  function toggleDomain(key: string) {
    const next = new Set(openDomains);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setOpenDomains(next);
  }

  return (
    <nav className="space-y-2 text-[13px]">
      {CORPUS_ORDER.map((ck) => {
        const meta = CORPUS_META[ck];
        const buckets = byCorpus[ck];
        const totalPages = buckets.reduce((acc, b) => acc + b.pages.length, 0);
        const corpusOpen = openCorpora.has(ck);
        return (
          <div key={ck}>
            <button
              type="button"
              onClick={() => toggleCorpus(ck)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[var(--text)] hover:bg-[var(--bg-elev)]"
              title={meta.description}
            >
              <Chevron open={corpusOpen} />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                {meta.label}
              </span>
              <span className="ml-auto text-[10px] text-[var(--text-faint)]">{totalPages}</span>
            </button>
            {corpusOpen && (
              <div className="mt-0.5 pl-2">
                {buckets.length === 0 ? (
                  <div className="px-3 py-1.5 text-[11px] text-[var(--text-faint)]">
                    {meta.emptyHint ? (
                      <Link to={meta.emptyHint.href} className="text-blue-400 hover:underline">
                        {meta.emptyHint.text}
                      </Link>
                    ) : (
                      <span>Nothing here yet.</span>
                    )}
                  </div>
                ) : (
                  <ul className="space-y-0.5">
                    {buckets.map((b) => {
                      const key = `${ck}:${b.slug}`;
                      const open = openDomains.has(key);
                      const isActiveDomain =
                        b.index_slug === activeSlug ||
                        b.pages.some((p) => p.slug === activeSlug);
                      return (
                        <li key={key}>
                          <div className="flex items-stretch">
                            <button
                              type="button"
                              onClick={() => toggleDomain(key)}
                              className="flex w-5 items-center justify-center text-[var(--text-faint)] hover:text-[var(--text)]"
                            >
                              <Chevron open={open} size={9} />
                            </button>
                            <Link
                              to={b.index_slug ? `/wiki/${b.index_slug}` : "/wiki"}
                              className={`flex flex-1 items-center gap-2 rounded-md px-2 py-1 transition ${
                                isActiveDomain
                                  ? "bg-blue-500/20 font-medium text-[var(--accent)]"
                                  : "text-[var(--text)] hover:bg-[var(--bg-elev)]"
                              }`}
                            >
                              <span
                                aria-hidden
                                style={{
                                  width: 8,
                                  height: 8,
                                  borderRadius: 2,
                                  background: b.color || "#3b82f6",
                                  flexShrink: 0,
                                }}
                              />
                              <span className="truncate text-[12px]">{b.name}</span>
                              <span className="ml-auto text-[10px] text-[var(--text-faint)]">
                                {b.pages.length}
                              </span>
                            </Link>
                          </div>
                          {open && b.pages.length > 0 && (
                            <ul className="ml-2.5 mt-0.5 space-y-0.5 border-l border-[var(--border)] pl-7">
                              {b.pages.map((p) => (
                                <li key={p.slug}>
                                  <Link
                                    to={`/wiki/${p.slug}`}
                                    className={`block truncate rounded-md px-2 py-0.5 text-[11.5px] transition ${
                                      activeSlug === p.slug
                                        ? "bg-blue-500/20 font-medium text-[var(--accent)]"
                                        : "text-[var(--text-muted)] hover:bg-[var(--bg-elev)] hover:text-[var(--text)]"
                                    }`}
                                  >
                                    {p.title}
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function Chevron({ open, size = 10 }: { open: boolean; size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        transform: open ? "rotate(90deg)" : "none",
        transition: "transform 120ms",
        fontSize: size,
        lineHeight: 1,
      }}
    >
      ▶
    </span>
  );
}

function filterTree(tree: TreeDomain[], q: string): TreeDomain[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return tree;
  return tree
    .map((d) => {
      const matchesDomain =
        d.name.toLowerCase().includes(needle) ||
        (d.description ?? "").toLowerCase().includes(needle);
      const pages = d.pages.filter(
        (p) =>
          p.title.toLowerCase().includes(needle) ||
          (p.summary ?? "").toLowerCase().includes(needle),
      );
      if (matchesDomain) return d;
      if (pages.length > 0) return { ...d, pages };
      return null;
    })
    .filter((d): d is TreeDomain => d !== null);
}

function bucketByCorpus(tree: TreeDomain[]): Record<CorpusKey, BucketedDomain[]> {
  const out: Record<CorpusKey, BucketedDomain[]> = { data: [], code: [], docs: [] };
  for (const d of tree) {
    for (const ck of CORPUS_ORDER) {
      const meta = CORPUS_META[ck];
      const pages = d.pages.filter((p) => meta.matches(p.corpus));
      if (pages.length === 0) continue;
      out[ck].push({
        slug: d.slug,
        name: d.name,
        description: d.description,
        color: d.color,
        index_slug: d.index_slug,
        pages,
      });
    }
  }
  return out;
}
