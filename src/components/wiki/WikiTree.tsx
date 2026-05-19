"use client";
import Link from "next/link";
import { useState } from "react";
import type { TreeDomain, TreePage } from "./types";

type CorpusKey = "data" | "code" | "docs";

const CORPUS_META: Record<CorpusKey, { label: string; description: string; emptyHint: { text: string; href: string } | null; matches: (corpus: string | null) => boolean }> = {
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

/**
 * Three-tier tree: Corpus (Data / GitLab / Business documents) → Domain →
 * Page. Each level is independently collapsible; the level containing the
 * active page is auto-opened on mount.
 */
export default function WikiTree({
  tree,
  activeSlug,
}: {
  tree: TreeDomain[];
  activeSlug: string | null;
}) {
  // Group pages by corpus first, then by domain.
  const byCorpus = bucketByCorpus(tree);

  const [openCorpora, setOpenCorpora] = useState<Set<CorpusKey>>(() => {
    const next = new Set<CorpusKey>();
    // Always open Data; open others only if they contain the active page.
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
    <nav className="text-[13px] space-y-2">
      {CORPUS_ORDER.map((ck) => {
        const meta = CORPUS_META[ck];
        const buckets = byCorpus[ck];
        const totalPages = buckets.reduce((acc, b) => acc + b.pages.length, 0);
        const corpusOpen = openCorpora.has(ck);
        return (
          <div key={ck}>
            <button
              onClick={() => toggleCorpus(ck)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--bg-elev)] text-[var(--text)]"
              title={meta.description}
            >
              <Chevron open={corpusOpen} />
              <span className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-faint)]">
                {meta.label}
              </span>
              <span className="ml-auto text-[10px] text-[var(--text-faint)]">{totalPages}</span>
            </button>
            {corpusOpen && (
              <div className="pl-2 mt-0.5">
                {buckets.length === 0 ? (
                  <div className="px-3 py-1.5 text-[11px] text-[var(--text-faint)]">
                    {meta.emptyHint ? (
                      <Link href={meta.emptyHint.href} className="text-[var(--accent)] hover:underline">
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
                        b.index_slug === activeSlug || b.pages.some((p) => p.slug === activeSlug);
                      return (
                        <li key={key}>
                          <div className="flex items-stretch">
                            <button
                              onClick={() => toggleDomain(key)}
                              className="w-5 flex items-center justify-center text-[var(--text-faint)] hover:text-[var(--text)]"
                            >
                              <Chevron open={open} size={9} />
                            </button>
                            <Link
                              href={b.index_slug ? `/wiki/${b.index_slug}` : "/wiki"}
                              className={`flex-1 flex items-center gap-2 px-2 py-1 rounded-md transition ${
                                isActiveDomain
                                  ? "bg-[var(--accent-soft)] text-[var(--accent)] font-medium"
                                  : "text-[var(--text)] hover:bg-[var(--bg-elev)]"
                              }`}
                            >
                              <span
                                aria-hidden
                                style={{
                                  width: 8,
                                  height: 8,
                                  borderRadius: 2,
                                  background: b.color || "var(--accent)",
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
                            <ul className="pl-7 mt-0.5 space-y-0.5 border-l border-[var(--border)] ml-2.5">
                              {b.pages.map((p) => (
                                <li key={p.slug}>
                                  <Link
                                    href={`/wiki/${p.slug}`}
                                    className={`block px-2 py-0.5 rounded-md text-[11.5px] transition truncate ${
                                      activeSlug === p.slug
                                        ? "bg-[var(--accent-soft)] text-[var(--accent)] font-medium"
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

/**
 * Take the flat domain list and bucket each domain's pages into corpus
 * groups. A domain can appear under multiple corpora — once for each corpus
 * it has pages in (so "Quality" might show under both Data and Business
 * documents if it has tables AND a runbook).
 */
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

type BucketedDomain = {
  slug: string;
  name: string;
  description: string | null;
  color: string | null;
  index_slug: string | null;
  pages: TreePage[];
};
