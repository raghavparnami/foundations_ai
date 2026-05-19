"use client";
import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type WikiKind = "tables" | "docs" | "code";

type PageSummary = {
  id: number;
  kind: WikiKind;
  slug: string;
  title: string;
  summary: string | null;
  status: string;
  updated_at: string;
};

type PageFull = {
  id: number;
  kind: WikiKind;
  slug: string;
  title: string;
  summary: string | null;
  body_md: string;
  source_ref: unknown;
  status: string;
  generated_at: string | null;
  updated_at: string;
};

type Backlink = { kind: WikiKind; slug: string; title: string };

const KIND_META: Record<WikiKind, { label: string; sub: string }> = {
  tables: { label: "Tables", sub: "structured database" },
  docs: { label: "Docs", sub: "uploaded + SharePoint" },
  code: { label: "Code", sub: "GitLab repos" },
};

export default function WikiBrowser() {
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [open, setOpen] = useState<{ kind: WikiKind; slug: string } | null>(null);
  const [full, setFull] = useState<PageFull | null>(null);
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [view, setView] = useState<"browse" | "upload" | "connect-code">("browse");

  const refresh = useCallback(async () => {
    const r = await fetch("/api/wiki");
    const j = await r.json();
    setPages(j.pages ?? []);
  }, []);

  useEffect(() => {
    void refresh();
    const iv = setInterval(refresh, 4000);
    return () => clearInterval(iv);
  }, [refresh]);

  useEffect(() => {
    if (!open) {
      setFull(null);
      setBacklinks([]);
      return;
    }
    let alive = true;
    fetch(`/api/wiki/${open.kind}/${open.slug}`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        setFull(j.page);
        setBacklinks(j.backlinks ?? []);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  const grouped: Record<WikiKind, PageSummary[]> = { tables: [], docs: [], code: [] };
  for (const p of pages) grouped[p.kind].push(p);

  return (
    <div className="flex-1 min-h-0 flex">
      {/* Left rail: 3 sections */}
      <aside className="w-[260px] shrink-0 border-r border-[var(--border)] bg-[var(--bg-soft)] overflow-y-auto">
        {(Object.keys(KIND_META) as WikiKind[]).map((k) => (
          <SectionGroup
            key={k}
            kind={k}
            pages={grouped[k]}
            activeSlug={open?.kind === k ? open.slug : null}
            onOpen={(slug) => {
              setView("browse");
              setOpen({ kind: k, slug });
            }}
            onAction={(action) => setView(action)}
          />
        ))}
      </aside>

      {/* Right pane */}
      <section className="flex-1 min-w-0 overflow-y-auto bg-[var(--bg)]">
        {view === "upload" && <UploadDoc onDone={() => { void refresh(); setView("browse"); }} />}
        {view === "connect-code" && <ConnectCode onDone={() => { void refresh(); setView("browse"); }} />}
        {view === "browse" && !open && <EmptyState pages={pages} />}
        {view === "browse" && open && full && (
          <PageView page={full} backlinks={backlinks} onJump={(k, s) => setOpen({ kind: k, slug: s })} />
        )}
      </section>
    </div>
  );
}

function SectionGroup({
  kind,
  pages,
  activeSlug,
  onOpen,
  onAction,
}: {
  kind: WikiKind;
  pages: PageSummary[];
  activeSlug: string | null;
  onOpen: (slug: string) => void;
  onAction: (action: "upload" | "connect-code") => void;
}) {
  const meta = KIND_META[kind];
  return (
    <div className="border-b border-[var(--border)] py-3">
      <div className="px-4 mb-1.5 flex items-center justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-semibold">
            {meta.label}
          </div>
          <div className="text-[10px] text-[var(--text-faint)]">{meta.sub}</div>
        </div>
        {kind === "docs" && (
          <button
            onClick={() => onAction("upload")}
            className="text-[10px] uppercase tracking-wider text-[var(--accent)] hover:underline"
            title="Upload a PDF / DOCX / MD"
          >
            + Upload
          </button>
        )}
        {kind === "code" && (
          <button
            onClick={() => onAction("connect-code")}
            className="text-[10px] uppercase tracking-wider text-[var(--accent)] hover:underline"
            title="Register a GitLab repo"
          >
            + Connect
          </button>
        )}
      </div>
      {pages.length === 0 ? (
        <div className="px-4 py-2 text-[11px] text-[var(--text-faint)]">
          {kind === "tables"
            ? "Waiting on initial tables-wiki tick…"
            : kind === "docs"
              ? "No docs yet — upload one."
              : "No repos connected yet."}
        </div>
      ) : (
        <ul>
          {pages.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => onOpen(p.slug)}
                className={`block w-full text-left px-4 py-1.5 text-[12px] transition truncate ${
                  activeSlug === p.slug
                    ? "bg-[var(--bg-elev)] text-[var(--text)] border-l-2 border-[var(--accent)]"
                    : "text-[var(--text-muted)] hover:bg-[var(--bg-elev)] hover:text-[var(--text)]"
                }`}
                title={p.summary ?? p.title}
              >
                {p.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyState({ pages }: { pages: PageSummary[] }) {
  return (
    <div className="max-w-[680px] mx-auto p-10 text-[var(--text-muted)]">
      <h2 className="text-lg font-semibold text-[var(--text)] mb-2">A wiki of everything Loom knows</h2>
      <p className="text-[13px] mb-4">
        {pages.length === 0
          ? "Three agents are about to start running. Pages will appear here as they generate."
          : `${pages.length} pages indexed so far. Pick one from the left rail.`}
      </p>
      <ul className="text-[12px] space-y-2">
        <li>
          <strong>Tables</strong> — Loom clusters your database by FK relationships into concept pages,
          cross-linked to the views and skills that touch them.
        </li>
        <li>
          <strong>Docs</strong> — upload PDFs, Word, or Markdown. Loom parses, chunks, and writes a
          structured page per document. SharePoint MCP integration sits behind this same corpus.
        </li>
        <li>
          <strong>Code</strong> — register a GitLab repo; Loom indexes the tree, clusters files by
          top-level module, and writes a page per module — including any table cross-refs found in
          the code.
        </li>
      </ul>
    </div>
  );
}

function PageView({
  page,
  backlinks,
  onJump,
}: {
  page: PageFull;
  backlinks: Backlink[];
  onJump: (kind: WikiKind, slug: string) => void;
}) {
  // Replace [[kind/slug]] occurrences with anchor tags rendered by react-markdown.
  const rendered = page.body_md.replace(/\[\[(tables|docs|code)\/([a-z0-9._-]+)\]\]/g, (_m, k, s) => `[\`${k}/${s}\`](wiki:${k}/${s})`);
  return (
    <div className="max-w-[820px] mx-auto px-6 py-8">
      <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] mb-1">
        {page.kind}
      </div>
      <h1 className="text-[22px] font-semibold text-[var(--text)] mb-1">{page.title}</h1>
      {page.summary && <p className="text-[13px] text-[var(--text-muted)] mb-4">{page.summary}</p>}
      <div className="markdown-doc text-[14px]">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children }) => {
              if (typeof href === "string" && href.startsWith("wiki:")) {
                const m = href.match(/^wiki:(tables|docs|code)\/(.+)$/);
                if (m) {
                  return (
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        onJump(m[1] as WikiKind, m[2]!);
                      }}
                      className="text-[var(--accent)] underline decoration-dotted"
                    >
                      {children}
                    </a>
                  );
                }
              }
              return (
                <a href={href} target="_blank" rel="noreferrer" className="text-[var(--accent)] underline">
                  {children}
                </a>
              );
            },
          }}
        >
          {rendered}
        </ReactMarkdown>
      </div>
      {backlinks.length > 0 && (
        <div className="mt-8 pt-4 border-t border-[var(--border)]">
          <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] mb-2 font-semibold">
            Backlinks
          </div>
          <ul className="space-y-1">
            {backlinks.map((b) => (
              <li key={`${b.kind}-${b.slug}`}>
                <button
                  onClick={() => onJump(b.kind, b.slug)}
                  className="text-[12px] text-[var(--text-muted)] hover:text-[var(--accent)]"
                >
                  ← {b.kind}/{b.slug}{" "}
                  <span className="text-[var(--text-faint)]">— {b.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function UploadDoc({ onDone }: { onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit() {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/wiki/upload", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) {
        setMsg(j.error ?? "Upload failed");
      } else {
        setMsg("Uploaded — wiki page generating in the background.");
        setTimeout(onDone, 1500);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-[640px] mx-auto p-8">
      <h2 className="text-lg font-semibold mb-2">Upload a document</h2>
      <p className="text-[13px] text-[var(--text-muted)] mb-4">
        PDF, DOCX, Markdown, or plain text. Loom parses + chunks the file then writes a structured
        wiki page within seconds. Re-uploading the same content is idempotent.
      </p>
      <input
        type="file"
        accept=".pdf,.docx,.md,.markdown,.txt"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="block w-full text-sm text-[var(--text-muted)] file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-[var(--border)] file:bg-[var(--bg-elev)] file:text-[var(--text)]"
      />
      <div className="mt-4 flex items-center gap-3">
        <button
          disabled={!file || busy}
          onClick={submit}
          className="bg-[var(--accent)] text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-40 hover:bg-emerald-700 transition"
        >
          {busy ? "Uploading…" : "Upload & index"}
        </button>
        {msg && <span className="text-[12px] text-[var(--text-muted)]">{msg}</span>}
      </div>
      <p className="text-[11px] text-[var(--text-faint)] mt-6">
        <strong>SharePoint:</strong> connect via the SharePoint MCP server in Connections (next round).
      </p>
    </div>
  );
}

function ConnectCode({ onDone }: { onDone: () => void }) {
  const [displayName, setDisplayName] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://gitlab.com");
  const [tokenRef, setTokenRef] = useState("GITLAB_TOKEN");
  const [branch, setBranch] = useState("main");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/wiki/code-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "gitlab",
          display_name: displayName,
          project_path: projectPath,
          base_url: baseUrl,
          token_ref: tokenRef || null,
          default_branch: branch,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setMsg(j.error ?? "Failed to connect");
      } else {
        setMsg("Connected — code-wiki agent is syncing files now.");
        setTimeout(onDone, 1500);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-[640px] mx-auto p-8 space-y-3">
      <h2 className="text-lg font-semibold mb-1">Connect a GitLab repo</h2>
      <p className="text-[13px] text-[var(--text-muted)] mb-3">
        The code-wiki agent will pull files matching the include globs, cluster them by top-level
        directory, and write one wiki page per module.
      </p>
      <Field label="Display name">
        <input className="inp" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="loom/etl-pipelines" />
      </Field>
      <Field label="Project path (group/.../project)">
        <input className="inp font-mono text-[12px]" value={projectPath} onChange={(e) => setProjectPath(e.target.value)} placeholder="loom/etl-pipelines" />
      </Field>
      <Field label="GitLab base URL">
        <input className="inp" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
      </Field>
      <Field label="Token env var (name only, no secret)">
        <input className="inp font-mono text-[12px]" value={tokenRef} onChange={(e) => setTokenRef(e.target.value)} placeholder="GITLAB_TOKEN" />
        <p className="text-[10px] text-[var(--text-faint)] mt-1">Set this env var in .env.local. Never paste the token in the form.</p>
      </Field>
      <Field label="Default branch">
        <input className="inp" value={branch} onChange={(e) => setBranch(e.target.value)} />
      </Field>
      <div className="flex items-center gap-3 pt-2">
        <button
          disabled={busy || !displayName || !projectPath}
          onClick={submit}
          className="bg-[var(--accent)] text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-40 hover:bg-emerald-700 transition"
        >
          {busy ? "Connecting…" : "Connect & sync"}
        </button>
        {msg && <span className="text-[12px] text-[var(--text-muted)]">{msg}</span>}
      </div>
      <style>{`.inp { width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; font-size: 13px; color: var(--text); outline: none; } .inp:focus { border-color: var(--accent); }`}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] mb-1 font-semibold">{label}</div>
      {children}
    </label>
  );
}
