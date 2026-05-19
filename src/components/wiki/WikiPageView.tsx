"use client";
import Link from "next/link";
import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import type { Backlink, WikiPage } from "./types";

/**
 * Renders a single wiki page with:
 *   - Breadcrumbs (Wiki / Domain / Page)
 *   - Title + summary header with metadata pills
 *   - Markdown body with [[slug]] resolved to <Link>
 *   - TOC (right rail) extracted from headings
 *   - Backlinks panel grouped by domain
 *
 * The component is split so the parent can layout the rails however it
 * wants — left tree, center body, right TOC+meta+backlinks.
 */
export default function WikiPageView({
  page,
  backlinks,
}: {
  page: WikiPage;
  backlinks: Backlink[];
}) {
  // Strip the markdown title line (we render our own header).
  const bodyForRender = useMemo(() => stripLeadingTitle(page.body_md), [page.body_md]);
  const toc = useMemo(() => extractHeadings(bodyForRender), [bodyForRender]);

  return (
    <article className="flex-1 min-w-0 flex">
      <div className="flex-1 min-w-0 overflow-y-auto px-10 py-8 bg-[var(--bg-elev)]">
        <Breadcrumbs
          domain={page.domain_slug ? { slug: page.domain_slug, name: page.domain_name ?? page.domain_slug } : null}
          page={page}
        />
        <header className="border-b border-[var(--border)] pb-5 mb-6">
          <h1 className="text-[28px] font-semibold tracking-tight leading-tight text-[var(--text)]">
            {page.title}
          </h1>
          {page.summary && (
            <p className="mt-2 text-[14px] text-[var(--text-muted)]">{page.summary}</p>
          )}
          <MetaPills page={page} />
        </header>

        <div className="wiki-prose">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={markdownComponents(page)}
          >
            {bodyForRender}
          </ReactMarkdown>
        </div>

        {backlinks.length > 0 && (
          <section className="mt-12 pt-6 border-t border-[var(--border)]">
            <h3 className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] mb-3">
              {backlinks.length} page{backlinks.length === 1 ? "" : "s"} link here
            </h3>
            <BacklinksList items={backlinks} />
          </section>
        )}
      </div>

      <aside className="hidden xl:flex flex-col w-[260px] shrink-0 border-l border-[var(--border)] bg-[var(--bg-soft)] overflow-y-auto px-5 py-8 text-[12px]">
        {toc.length > 0 && (
          <div className="mb-6">
            <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] mb-2 font-semibold">
              On this page
            </h4>
            <ul className="space-y-0.5">
              {toc.map((h) => (
                <li key={h.id}>
                  <a
                    href={`#${h.id}`}
                    className={`block py-0.5 text-[var(--text-muted)] hover:text-[var(--accent)]`}
                    style={{ paddingLeft: (h.level - 1) * 8 }}
                  >
                    {h.text}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mb-6">
          <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] mb-2 font-semibold">
            Page details
          </h4>
          <dl className="space-y-1.5 text-[11px]">
            {page.domain_name && (
              <Row label="Domain">
                <Link
                  href={`/wiki/domain/${page.domain_slug}`}
                  className="text-[var(--accent)] hover:underline"
                >
                  {page.domain_name}
                </Link>
              </Row>
            )}
            <Row label="Type">
              <span className="text-[var(--text)]">{page.page_type}</span>
            </Row>
            {page.corpus && (
              <Row label="Source">
                <span className="text-[var(--text)]">{page.corpus}</span>
              </Row>
            )}
            <Row label="Updated">
              <span className="text-[var(--text)]">{relTime(page.updated_at)}</span>
            </Row>
            <Row label="Status">
              <span className="text-[var(--text)]">{page.status}</span>
            </Row>
          </dl>
        </div>

        {backlinks.length > 0 && (
          <div>
            <h4 className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] mb-2 font-semibold">
              Backlinks
            </h4>
            <BacklinksList items={backlinks} compact />
          </div>
        )}
      </aside>
    </article>
  );
}

function Breadcrumbs({
  domain,
  page,
}: {
  domain: { slug: string; name: string } | null;
  page: WikiPage;
}) {
  return (
    <nav className="flex items-center gap-1.5 text-[12px] text-[var(--text-faint)] mb-4">
      <Link href="/wiki" className="hover:text-[var(--accent)]">
        Wiki
      </Link>
      {domain && (
        <>
          <span>/</span>
          <Link
            href={`/wiki/domain/${domain.slug}`}
            className="hover:text-[var(--accent)]"
          >
            {domain.name}
          </Link>
        </>
      )}
      <span>/</span>
      <span className="text-[var(--text-muted)]">{page.title}</span>
    </nav>
  );
}

function MetaPills({ page }: { page: WikiPage }) {
  return (
    <div className="mt-3 flex items-center gap-3 text-[11px]">
      <Pill>{page.page_type}</Pill>
      {page.corpus && <Pill kind="muted">{page.corpus}</Pill>}
      <span className="text-[var(--text-faint)]">
        Updated {relTime(page.updated_at)} · by Loom agent
      </span>
    </div>
  );
}

function Pill({
  children,
  kind = "accent",
}: {
  children: React.ReactNode;
  kind?: "accent" | "muted";
}) {
  const cls =
    kind === "accent"
      ? "bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent)]/30"
      : "bg-[var(--bg)] text-[var(--text-muted)] border-[var(--border)]";
  return (
    <span className={`px-2 py-0.5 rounded-full border text-[10px] uppercase tracking-wider font-semibold ${cls}`}>
      {children}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-16 text-[var(--text-faint)]">{label}</dt>
      <dd className="flex-1 min-w-0 truncate">{children}</dd>
    </div>
  );
}

function BacklinksList({ items, compact = false }: { items: Backlink[]; compact?: boolean }) {
  const grouped = new Map<string, Backlink[]>();
  for (const b of items) {
    const key = b.domain_name ?? "_other";
    const arr = grouped.get(key) ?? [];
    arr.push(b);
    grouped.set(key, arr);
  }
  return (
    <div className="space-y-3">
      {[...grouped.entries()].map(([domain, group]) => (
        <div key={domain}>
          {!compact && domain !== "_other" && (
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] mb-1">
              {domain}
            </div>
          )}
          <ul className="space-y-0.5">
            {group.map((b) => (
              <li key={b.slug}>
                <Link
                  href={`/wiki/${b.slug}`}
                  className="block text-[12px] text-[var(--text-muted)] hover:text-[var(--accent)] truncate"
                  title={b.summary ?? undefined}
                >
                  {b.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function markdownComponents(_page: WikiPage): Components {
  return {
    h1: ({ children, ...props }) => {
      const id = slugifyText(children);
      return (
        <h1 id={id} {...props}>
          {children}
        </h1>
      );
    },
    h2: ({ children, ...props }) => {
      const id = slugifyText(children);
      return (
        <h2 id={id} {...props}>
          {children}
        </h2>
      );
    },
    h3: ({ children, ...props }) => {
      const id = slugifyText(children);
      return (
        <h3 id={id} {...props}>
          {children}
        </h3>
      );
    },
    // Resolve [[slug]] inside text nodes by post-processing.
    p: ({ children, ...props }) => <p {...props}>{renderWikiLinks(children)}</p>,
    li: ({ children, ...props }) => <li {...props}>{renderWikiLinks(children)}</li>,
  };
}

function renderWikiLinks(children: React.ReactNode): React.ReactNode {
  if (typeof children === "string") {
    return splitWikiLinks(children);
  }
  if (Array.isArray(children)) {
    return children.map((c, i) =>
      typeof c === "string" ? <span key={i}>{splitWikiLinks(c)}</span> : c,
    );
  }
  return children;
}

function splitWikiLinks(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /\[\[([^\]\n|]+?)(?:\|([^\]\n]+))?\]\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const slug = m[1]!.trim();
    const label = (m[2] ?? slug.split("/").slice(-1)[0])!.trim();
    parts.push(
      <Link
        key={`${slug}-${m.index}`}
        href={`/wiki/${slug}`}
        className="text-[var(--accent)] underline decoration-[var(--accent)]/30 hover:decoration-[var(--accent)]"
      >
        {label}
      </Link>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function extractHeadings(md: string): { id: string; text: string; level: number }[] {
  const out: { id: string; text: string; level: number }[] = [];
  const re = /^(#{1,3})\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    const level = m[1]!.length;
    const text = m[2]!.trim();
    out.push({ id: slugifyText(text), text, level });
  }
  return out;
}

function slugifyText(c: React.ReactNode): string {
  const text = typeof c === "string" ? c : Array.isArray(c) ? c.join(" ") : String(c ?? "");
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function stripLeadingTitle(md: string): string {
  return md.replace(/^\s*#\s+.+\n+/, "");
}

function relTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso;
  const diff = Date.now() - t;
  const m = Math.round(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
