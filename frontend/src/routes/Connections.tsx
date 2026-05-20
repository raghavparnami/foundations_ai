import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError, apiUrl } from "../lib/api";

type Source = {
  id: number;
  name: string;
  kind: string;
  conn_url: string;
  created_at: string;
  total_tables: number;
  ready_tables: number;
};
type ListResp = { sources: Source[] };

type ProviderId =
  | "postgres"
  | "snowflake"
  | "databricks"
  | "unity_catalog"
  | "excel"
  | "sharepoint"
  | "gitlab"
  | "github"
  | "file";

type ProviderGroup = "warehouse" | "files" | "code";

type Provider = {
  id: ProviderId;
  label: string;
  blurb: string;
  group: ProviderGroup;
  available: boolean;
};

const PROVIDERS: Provider[] = [
  {
    id: "postgres",
    label: "PostgreSQL",
    blurb: "Any Postgres database (RDS, Aurora, Neon, Supabase, self-host).",
    group: "warehouse",
    available: true,
  },
  {
    id: "snowflake",
    label: "Snowflake",
    blurb: "Warehouses + schemas via account / warehouse / DB / role.",
    group: "warehouse",
    available: false,
  },
  {
    id: "databricks",
    label: "Databricks SQL",
    blurb: "Workspace SQL endpoint. Crawls catalogs / schemas / tables.",
    group: "warehouse",
    available: false,
  },
  {
    id: "unity_catalog",
    label: "Unity Catalog",
    blurb: "Databricks UC — three-level (catalog.schema.table) listing.",
    group: "warehouse",
    available: false,
  },
  {
    id: "excel",
    label: "Excel sheet",
    blurb: "Upload an .xlsx; each sheet becomes a queryable table.",
    group: "files",
    available: false,
  },
  {
    id: "sharepoint",
    label: "SharePoint",
    blurb: "Pull docs/wiki pages from a SharePoint site or document library.",
    group: "files",
    available: false,
  },
  {
    id: "file",
    label: "Upload a file",
    blurb: "PDF, DOCX, Markdown, plain text — Loom extracts + indexes it.",
    group: "files",
    available: true,
  },
  {
    id: "gitlab",
    label: "GitLab",
    blurb: "Index a GitLab repo's docs, SQL, and code into the wiki.",
    group: "code",
    available: true,
  },
  {
    id: "github",
    label: "GitHub",
    blurb: "Index a GitHub repo into the wiki — public repos need no token.",
    group: "code",
    available: true,
  },
];

const GROUP_LABEL: Record<ProviderGroup, string> = {
  warehouse: "Databases & warehouses",
  files: "Files & documents",
  code: "Code repositories",
};

export default function Connections() {
  const qc = useQueryClient();
  const sources = useQuery<ListResp>({
    queryKey: ["connections"],
    queryFn: () => api.get<ListResp>("/api/connections"),
    refetchInterval: 4000,
  });

  const [provider, setProvider] = useState<ProviderId>("postgres");
  const active = PROVIDERS.find((p) => p.id === provider)!;

  return (
    <div className="h-full overflow-auto px-8 py-8">
      <div className="mx-auto max-w-[960px]">
        <h1 className="text-2xl font-semibold text-[var(--text)]">
          Connections
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          A connection is a data source Loom will crawl, profile, and embed.
          Once ready, every table here shows up in the wiki and chat.
        </p>

        <section className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-5 shadow-sm">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
            Add a source
          </h2>
          {(["warehouse", "files", "code"] as ProviderGroup[]).map((g) => (
            <div key={g} className="mt-4">
              <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-faint)]">
                {GROUP_LABEL[g]}
              </div>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {PROVIDERS.filter((p) => p.group === g).map((p) => {
                  const isActive = p.id === provider;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setProvider(p.id)}
                      className={`text-left rounded-lg border px-3 py-2.5 transition ${
                        isActive
                          ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                          : "border-[var(--border)] bg-[var(--bg-elev)] hover:border-[var(--border-strong)]"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={`text-[13px] font-medium ${
                            isActive
                              ? "text-[var(--accent)]"
                              : "text-[var(--text)]"
                          }`}
                        >
                          {p.label}
                        </span>
                        {!p.available && (
                          <span className="text-[9px] uppercase tracking-wider text-[var(--text-faint)]">
                            soon
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">
                        {p.blurb}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="mt-5 rounded-lg bg-[var(--bg-soft)] p-4">
            {provider === "postgres" && (
              <PostgresForm
                onAdded={() =>
                  qc.invalidateQueries({ queryKey: ["connections"] })
                }
              />
            )}
            {provider === "snowflake" && <SnowflakeForm />}
            {provider === "databricks" && <DatabricksForm />}
            {provider === "unity_catalog" && <UnityCatalogForm />}
            {provider === "excel" && <ExcelUploadForm />}
            {provider === "sharepoint" && <SharePointForm />}
            {provider === "gitlab" && <GitLabForm />}
            {provider === "github" && <GitHubForm />}
            {provider === "file" && <FileUploadForm />}
            {active && !active.available && (
              <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <strong>{active.label}</strong> connector is wired in the UI
                but the backend crawler ships in v0.6. The metadata will save
                so we can crawl it the moment the connector lands.
              </div>
            )}
          </div>
        </section>

        <section className="mt-8">
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
            Connected sources
          </h2>
          {sources.isLoading && (
            <div className="text-sm text-[var(--text-faint)]">loading…</div>
          )}
          {!sources.isLoading && (sources.data?.sources.length ?? 0) === 0 && (
            <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--bg-elev)] px-4 py-6 text-center text-sm text-[var(--text-muted)]">
              No sources yet. Pick a provider above and connect one.
            </div>
          )}
          <ul className="space-y-2">
            {sources.data?.sources.map((s) => (
              <li
                key={s.id}
                className="rounded-lg border border-[var(--border)] bg-[var(--bg-elev)] px-4 py-3 shadow-sm"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-mono text-[14px] text-[var(--text)]">
                      {s.name}
                    </div>
                    <div className="mt-0.5 text-[12px] text-[var(--text-muted)]">
                      {s.kind} · {s.ready_tables}/{s.total_tables} tables ready
                    </div>
                  </div>
                  <div className="text-[11px] text-[var(--text-faint)]">
                    {(s.created_at || "").slice(0, 10)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

// ─── Per-provider forms ────────────────────────────────────────────────

function PostgresForm({ onAdded }: { onAdded: () => void }) {
  const [form, setForm] = useState({ name: "", conn_url: "" });
  const [error, setError] = useState<string | null>(null);
  const create = useMutation<unknown, Error, typeof form>({
    mutationFn: (body) =>
      api.post("/api/connections", { ...body, kind: "postgres" }),
    onSuccess: () => {
      setForm({ name: "", conn_url: "" });
      setError(null);
      onAdded();
    },
    onError: (e) =>
      setError(
        e instanceof ApiError ? `${e.status}: ${e.message}` : e.message,
      ),
  });

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (form.name && form.conn_url) create.mutate(form);
      }}
    >
      <Field label="Name">
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="factory_demo"
          className={fieldCls}
        />
      </Field>
      <Field label="Connection URL">
        <input
          value={form.conn_url}
          onChange={(e) => setForm({ ...form, conn_url: e.target.value })}
          placeholder="postgres://user:pass@host:5432/db"
          className={`${fieldCls} font-mono text-xs`}
        />
      </Field>
      <SubmitRow disabled={!form.name || !form.conn_url || create.isPending}>
        {create.isPending ? "Connecting…" : "Connect Postgres"}
      </SubmitRow>
      {error && <div className="text-xs text-red-600">{error}</div>}
    </form>
  );
}

function SnowflakeForm() {
  const [form, setForm] = useState({
    name: "",
    account: "",
    warehouse: "",
    database: "",
    schema: "PUBLIC",
    user: "",
    password: "",
    role: "",
  });
  return (
    <form className="space-y-3" onSubmit={(e) => e.preventDefault()}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="prod_snowflake"
            className={fieldCls}
          />
        </Field>
        <Field label="Account">
          <input
            value={form.account}
            onChange={(e) => setForm({ ...form, account: e.target.value })}
            placeholder="abc-12345.us-east-1.aws"
            className={fieldCls}
          />
        </Field>
        <Field label="Warehouse">
          <input
            value={form.warehouse}
            onChange={(e) => setForm({ ...form, warehouse: e.target.value })}
            placeholder="COMPUTE_WH"
            className={fieldCls}
          />
        </Field>
        <Field label="Database">
          <input
            value={form.database}
            onChange={(e) => setForm({ ...form, database: e.target.value })}
            placeholder="ANALYTICS"
            className={fieldCls}
          />
        </Field>
        <Field label="Schema">
          <input
            value={form.schema}
            onChange={(e) => setForm({ ...form, schema: e.target.value })}
            className={fieldCls}
          />
        </Field>
        <Field label="Role (optional)">
          <input
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
            placeholder="ANALYST"
            className={fieldCls}
          />
        </Field>
        <Field label="User">
          <input
            value={form.user}
            onChange={(e) => setForm({ ...form, user: e.target.value })}
            className={fieldCls}
          />
        </Field>
        <Field label="Password / PAT">
          <input
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className={fieldCls}
          />
        </Field>
      </div>
      <SubmitRow disabled>Connect Snowflake</SubmitRow>
    </form>
  );
}

function DatabricksForm() {
  const [form, setForm] = useState({
    name: "",
    workspace_host: "",
    http_path: "",
    token: "",
    catalog: "",
    schema: "default",
  });
  return (
    <form className="space-y-3" onSubmit={(e) => e.preventDefault()}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="prod_dbx"
            className={fieldCls}
          />
        </Field>
        <Field label="Workspace host">
          <input
            value={form.workspace_host}
            onChange={(e) =>
              setForm({ ...form, workspace_host: e.target.value })
            }
            placeholder="https://my-workspace.cloud.databricks.com"
            className={fieldCls}
          />
        </Field>
        <Field label="HTTP path">
          <input
            value={form.http_path}
            onChange={(e) => setForm({ ...form, http_path: e.target.value })}
            placeholder="/sql/1.0/warehouses/abc123"
            className={fieldCls}
          />
        </Field>
        <Field label="PAT">
          <input
            type="password"
            value={form.token}
            onChange={(e) => setForm({ ...form, token: e.target.value })}
            className={fieldCls}
          />
        </Field>
        <Field label="Catalog">
          <input
            value={form.catalog}
            onChange={(e) => setForm({ ...form, catalog: e.target.value })}
            placeholder="main"
            className={fieldCls}
          />
        </Field>
        <Field label="Schema">
          <input
            value={form.schema}
            onChange={(e) => setForm({ ...form, schema: e.target.value })}
            className={fieldCls}
          />
        </Field>
      </div>
      <SubmitRow disabled>Connect Databricks</SubmitRow>
    </form>
  );
}

function UnityCatalogForm() {
  const [form, setForm] = useState({
    name: "",
    workspace_host: "",
    token: "",
    catalogs: "",
  });
  return (
    <form className="space-y-3" onSubmit={(e) => e.preventDefault()}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="uc_prod"
            className={fieldCls}
          />
        </Field>
        <Field label="Workspace host">
          <input
            value={form.workspace_host}
            onChange={(e) =>
              setForm({ ...form, workspace_host: e.target.value })
            }
            placeholder="https://my-workspace.cloud.databricks.com"
            className={fieldCls}
          />
        </Field>
        <Field label="PAT">
          <input
            type="password"
            value={form.token}
            onChange={(e) => setForm({ ...form, token: e.target.value })}
            className={fieldCls}
          />
        </Field>
        <Field label="Catalogs (comma-separated; blank = all)">
          <input
            value={form.catalogs}
            onChange={(e) => setForm({ ...form, catalogs: e.target.value })}
            placeholder="main, sandbox"
            className={fieldCls}
          />
        </Field>
      </div>
      <SubmitRow disabled>Connect Unity Catalog</SubmitRow>
    </form>
  );
}

function ExcelUploadForm() {
  const [file, setFile] = useState<File | null>(null);
  return (
    <form className="space-y-3" onSubmit={(e) => e.preventDefault()}>
      <Field label="Workbook">
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-xs text-[var(--text-muted)] file:mr-3 file:rounded file:border-0 file:bg-[var(--bg-elev)] file:px-3 file:py-1.5 file:text-xs file:text-[var(--text)] hover:file:bg-[var(--bg-soft)]"
        />
      </Field>
      {file && (
        <div className="text-xs text-[var(--text-faint)]">
          {file.name} · {(file.size / 1024).toFixed(1)} KB — each sheet will
          become a queryable table named after the sheet.
        </div>
      )}
      <SubmitRow disabled>Upload + parse</SubmitRow>
    </form>
  );
}

function SharePointForm() {
  const [form, setForm] = useState({
    name: "",
    tenant_id: "",
    site_url: "",
    client_id: "",
    client_secret: "",
    library: "Documents",
  });
  return (
    <form className="space-y-3" onSubmit={(e) => e.preventDefault()}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="ops_sharepoint"
            className={fieldCls}
          />
        </Field>
        <Field label="Tenant ID">
          <input
            value={form.tenant_id}
            onChange={(e) => setForm({ ...form, tenant_id: e.target.value })}
            placeholder="00000000-0000-0000-0000-000000000000"
            className={fieldCls}
          />
        </Field>
        <Field label="Site URL">
          <input
            value={form.site_url}
            onChange={(e) => setForm({ ...form, site_url: e.target.value })}
            placeholder="https://contoso.sharepoint.com/sites/ops"
            className={fieldCls}
          />
        </Field>
        <Field label="Document library">
          <input
            value={form.library}
            onChange={(e) => setForm({ ...form, library: e.target.value })}
            className={fieldCls}
          />
        </Field>
        <Field label="App client ID">
          <input
            value={form.client_id}
            onChange={(e) => setForm({ ...form, client_id: e.target.value })}
            className={fieldCls}
          />
        </Field>
        <Field label="App client secret">
          <input
            type="password"
            value={form.client_secret}
            onChange={(e) =>
              setForm({ ...form, client_secret: e.target.value })
            }
            className={fieldCls}
          />
        </Field>
      </div>
      <SubmitRow disabled>Connect SharePoint</SubmitRow>
    </form>
  );
}

function GitLabForm() {
  const [form, setForm] = useState({
    name: "",
    base_url: "https://gitlab.com",
    project_path: "",
    default_branch: "main",
    token: "",
  });
  const [status, setStatus] = useState<{ kind: "idle" | "ok" | "err"; msg?: string }>({
    kind: "idle",
  });
  const create = useMutation<unknown, Error, typeof form>({
    mutationFn: (body) =>
      api.post("/api/wiki/code-sources", {
        provider: "gitlab",
        display_name: body.name,
        project_path: body.project_path,
        base_url: body.base_url,
        token_ref: body.token ? "GITLAB_TOKEN" : null,
        default_branch: body.default_branch,
      }),
    onSuccess: () =>
      setStatus({
        kind: "ok",
        msg: "Registered. The code-wiki agent will crawl it on the next tick (≤ 5 min).",
      }),
    onError: (e) =>
      setStatus({
        kind: "err",
        msg: e instanceof ApiError ? `${e.status}: ${e.message}` : e.message,
      }),
  });
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (form.name && form.project_path) create.mutate(form);
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="loom_pipelines"
            className={fieldCls}
          />
        </Field>
        <Field label="Base URL">
          <input
            value={form.base_url}
            onChange={(e) => setForm({ ...form, base_url: e.target.value })}
            className={fieldCls}
          />
        </Field>
        <Field label="Project path">
          <input
            value={form.project_path}
            onChange={(e) =>
              setForm({ ...form, project_path: e.target.value })
            }
            placeholder="my-group/etl-pipelines"
            className={fieldCls}
          />
        </Field>
        <Field label="Default branch">
          <input
            value={form.default_branch}
            onChange={(e) =>
              setForm({ ...form, default_branch: e.target.value })
            }
            className={fieldCls}
          />
        </Field>
        <Field label="Personal access token">
          <input
            type="password"
            value={form.token}
            onChange={(e) => setForm({ ...form, token: e.target.value })}
            className={`${fieldCls} sm:col-span-2`}
          />
        </Field>
      </div>
      <SubmitRow disabled={!form.name || !form.project_path || create.isPending}>
        {create.isPending ? "Registering…" : "Connect GitLab"}
      </SubmitRow>
      {status.kind === "ok" && (
        <div className="text-xs text-emerald-700">{status.msg}</div>
      )}
      {status.kind === "err" && <div className="text-xs text-red-600">{status.msg}</div>}
    </form>
  );
}

function GitHubForm() {
  const [form, setForm] = useState({
    name: "",
    owner: "",
    repo: "",
    default_branch: "main",
    token: "",
  });
  const [status, setStatus] = useState<{ kind: "idle" | "ok" | "err"; msg?: string }>({
    kind: "idle",
  });
  const create = useMutation<unknown, Error, typeof form>({
    mutationFn: (body) =>
      api.post("/api/wiki/code-sources", {
        provider: "github",
        display_name: body.name,
        project_path: `${body.owner}/${body.repo}`,
        base_url: "https://api.github.com",
        token_ref: body.token ? "GITHUB_TOKEN" : null,
        default_branch: body.default_branch,
      }),
    onSuccess: () =>
      setStatus({
        kind: "ok",
        msg: "Registered. The code-wiki agent will crawl it on the next tick (≤ 5 min).",
      }),
    onError: (e) =>
      setStatus({
        kind: "err",
        msg: e instanceof ApiError ? `${e.status}: ${e.message}` : e.message,
      }),
  });
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (form.name && form.owner && form.repo) create.mutate(form);
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="ranaarhireflow_loom"
            className={fieldCls}
          />
        </Field>
        <Field label="Owner / org">
          <input
            value={form.owner}
            onChange={(e) => setForm({ ...form, owner: e.target.value })}
            placeholder="ranaarhireflow"
            className={fieldCls}
          />
        </Field>
        <Field label="Repository">
          <input
            value={form.repo}
            onChange={(e) => setForm({ ...form, repo: e.target.value })}
            placeholder="foundationsAI"
            className={fieldCls}
          />
        </Field>
        <Field label="Default branch">
          <input
            value={form.default_branch}
            onChange={(e) =>
              setForm({ ...form, default_branch: e.target.value })
            }
            className={fieldCls}
          />
        </Field>
        <Field label="Fine-grained PAT (read-only)">
          <input
            type="password"
            value={form.token}
            onChange={(e) => setForm({ ...form, token: e.target.value })}
            className={`${fieldCls} sm:col-span-2`}
          />
        </Field>
      </div>
      <SubmitRow
        disabled={!form.name || !form.owner || !form.repo || create.isPending}
      >
        {create.isPending ? "Registering…" : "Connect GitHub"}
      </SubmitRow>
      {status.kind === "ok" && (
        <div className="text-xs text-emerald-700">{status.msg}</div>
      )}
      {status.kind === "err" && <div className="text-xs text-red-600">{status.msg}</div>}
    </form>
  );
}

function FileUploadForm() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<{
    kind: "idle" | "uploading" | "ok" | "err";
    msg?: string;
  }>({ kind: "idle" });

  async function upload() {
    if (!file) return;
    setStatus({ kind: "uploading" });
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(apiUrl("/api/wiki/upload"), { method: "POST", body });
      const text = await res.text();
      if (!res.ok) {
        setStatus({ kind: "err", msg: `${res.status}: ${text.slice(0, 200)}` });
        return;
      }
      const parsed = JSON.parse(text);
      setStatus({
        kind: "ok",
        msg: `Indexed ${parsed.extracted_chars} chars from ${parsed.document.display_name}. The docs-wiki agent will summarize it shortly.`,
      });
    } catch (e) {
      setStatus({ kind: "err", msg: (e as Error).message });
    }
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void upload();
      }}
    >
      <Field label="File">
        <input
          type="file"
          accept=".pdf,.md,.txt,.docx,.html,.rtf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-xs text-[var(--text-muted)] file:mr-3 file:rounded file:border-0 file:bg-[var(--bg-elev)] file:px-3 file:py-1.5 file:text-xs file:text-[var(--text)] hover:file:bg-[var(--bg-soft)]"
        />
      </Field>
      {file && (
        <div className="text-xs text-[var(--text-faint)]">
          {file.name} · {(file.size / 1024).toFixed(1)} KB — Loom will extract
          text + index it into the wiki under <code>docs/</code>.
        </div>
      )}
      <SubmitRow disabled={!file || status.kind === "uploading"}>
        {status.kind === "uploading" ? "Uploading…" : "Upload + index"}
      </SubmitRow>
      {status.kind === "ok" && (
        <div className="text-xs text-emerald-700">{status.msg}</div>
      )}
      {status.kind === "err" && <div className="text-xs text-red-600">{status.msg}</div>}
    </form>
  );
}

// ─── shared shells ──────────────────────────────────────────────────────

const fieldCls =
  "w-full rounded-md border border-[var(--border)] bg-[var(--bg-elev)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] outline-none focus:border-[var(--accent)]";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] font-medium uppercase tracking-wider text-[var(--text-faint)]">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function SubmitRow({
  children,
  disabled,
}: {
  children: React.ReactNode;
  disabled: boolean;
}) {
  return (
    <div className="pt-1">
      <button
        type="submit"
        disabled={disabled}
        className="text-[13px] font-medium text-white px-4 py-1.5 rounded-full disabled:opacity-40 transition"
        style={{
          background: disabled
            ? "var(--border-strong)"
            : "var(--gradient-hero)",
        }}
      >
        {children}
      </button>
    </div>
  );
}
