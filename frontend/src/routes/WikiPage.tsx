import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../lib/api";
import WikiSidebar from "../components/wiki/WikiSidebar";
import type { PageResponse } from "../components/wiki/types";

/**
 * Deep page route `/wiki/*`. The slug is the entire path after `/wiki/`,
 * which may include slashes (e.g. `tables/public.deviations`,
 * `docs/runbook`, `domain/quality`).
 */
export default function WikiPage() {
  const location = useLocation();
  const slug = location.pathname.replace(/^\/wiki\/?/, "");

  const { data, isLoading, isError } = useQuery<PageResponse>({
    queryKey: ["wiki", "page", slug],
    queryFn: () =>
      api.get<PageResponse>(
        `/api/wiki/page?slug=${encodeURIComponent(slug)}`,
      ),
    enabled: slug.length > 0,
  });

  if (!slug) {
    return (
      <div className="flex h-full">
        <WikiSidebar activeSlug={null} />
        <div className="flex-1 p-10 text-[var(--text-muted)]">
          No slug — go back to the wiki home.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <WikiSidebar activeSlug={slug} />
      <div className="flex-1 min-w-0 overflow-y-auto bg-[var(--bg)] px-10 py-10">
        {isLoading && (
          <div className="text-[var(--text-faint)]">loading…</div>
        )}
        {isError && (
          <div className="text-red-600">
            Page not found.{" "}
            <Link to="/wiki" className="underline">
              Back to wiki
            </Link>
          </div>
        )}
        {data && (
          <article className="mx-auto max-w-[760px]">
            {data.page.domain_name && data.page.domain_slug && (
              <Link
                to={`/wiki/domain/${data.page.domain_slug}`}
                className="inline-block text-[11px] uppercase tracking-wider text-[var(--text-faint)] no-underline hover:text-[var(--text)] mb-3"
              >
                ← {data.page.domain_name}
              </Link>
            )}
            <h1 className="text-[28px] font-semibold tracking-tight text-[var(--text)] leading-tight">
              {data.page.title}
            </h1>
            {data.page.summary && (
              <p className="mt-2 text-[15px] text-[var(--text-muted)]">
                {data.page.summary}
              </p>
            )}

            <div className="wiki-prose mt-6">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a({ href, children, ...props }) {
                    if (href && isInternalSlug(href)) {
                      return (
                        <Link
                          to={`/wiki/${href}`}
                          className="text-[var(--accent)] hover:underline"
                        >
                          {children}
                        </Link>
                      );
                    }
                    return (
                      <a href={href} {...props}>
                        {children}
                      </a>
                    );
                  },
                }}
              >
                {linkifyWiki(data.page.body_md || "")}
              </ReactMarkdown>
            </div>

            {data.backlinks.length > 0 && (
              <section className="mt-12 border-t border-[var(--border)] pt-6">
                <h2 className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold">
                  Backlinks
                </h2>
                <ul className="mt-3 space-y-1 text-[14px]">
                  {data.backlinks.map((b) => (
                    <li key={b.slug}>
                      <Link
                        to={`/wiki/${b.slug}`}
                        className="text-[var(--accent)] hover:underline"
                      >
                        {b.title}
                      </Link>
                      {b.summary && (
                        <span className="text-[var(--text-faint)]"> — {b.summary}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {data.siblings && data.siblings.length > 0 && (
              <section className="mt-8 border-t border-[var(--border)] pt-6">
                <h2 className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold">
                  Siblings in this domain
                </h2>
                <ul className="mt-3 space-y-1 text-[14px]">
                  {data.siblings.map((s) => (
                    <li key={s.slug}>
                      <Link
                        to={`/wiki/${s.slug}`}
                        className="text-[var(--accent)] hover:underline"
                      >
                        {s.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </article>
        )}
      </div>
    </div>
  );
}

/** Looks like a wiki page slug we'd route through `<Link to={`/wiki/${href}`}>`. */
function isInternalSlug(href: string): boolean {
  // Already prefixed with kind: tables/x.y, docs/x, code/x, domain/x
  if (/^(tables|docs|code|domain)\//.test(href)) return true;
  // Bare slug — must look like a slug (no scheme, no leading slash, no spaces)
  if (/^[a-z0-9_][a-z0-9._\-/]*$/i.test(href)) return true;
  return false;
}

/**
 * Rewrite [[slug]] wiki-style refs to standard markdown links so ReactMarkdown
 * picks them up and our `a` override routes them through Link.
 *
 *   [[kind/slug]]  → kind/slug (kind ∈ tables|docs|code|domain, passthrough)
 *   [[X]]          → X (bare slug — backend resolver handles cross-kind lookup)
 */
function linkifyWiki(md: string): string {
  return md.replace(/\[\[([^\]\s][^\]]*)\]\]/g, (_m, raw: string) => {
    const slug = raw.trim();
    return `[${slug}](${slug})`;
  });
}
