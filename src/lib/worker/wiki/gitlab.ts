/**
 * Thin GitLab REST client used by the code-wiki agent. Uses @gitbeaker/rest
 * which talks to GitLab's v4 API. We only need read paths: project tree +
 * raw file fetch.
 *
 * Auth: looks up the token via the source's `token_ref` env var name. We do
 * NOT store tokens in the catalog DB — the indirection lets us rotate via
 * env without touching rows.
 */
import { Gitlab } from "@gitbeaker/rest";
import { minimatch } from "minimatch";

export type GitLabSourceConfig = {
  base_url: string;
  project_path: string;
  default_branch: string;
  token_ref: string | null;
  include_globs: string[];
  exclude_globs: string[];
};

export type RepoFile = {
  path: string;
  language: string | null;
  size_bytes: number;
  body: string;
  blob_sha: string;
};

export async function listMatchingFiles(cfg: GitLabSourceConfig): Promise<{
  files: RepoFile[];
  default_branch: string;
}> {
  const client = makeClient(cfg);

  // Get the project so we have its numeric ID + actual default branch.
  const project = (await client.Projects.show(cfg.project_path)) as {
    id: number;
    default_branch: string;
  };
  const ref = cfg.default_branch || project.default_branch || "main";

  // Walk the tree recursively. gitbeaker's offset pagination iterates all
  // pages; cap is enforced by maxPages. The type is widened with `as never`
  // because gitbeaker's keyset/offset discriminated union over-constrains
  // this call site.
  const tree: Array<{ path: string; type: string; mode: string; id: string }> = [];
  const batch = (await client.Repositories.allRepositoryTrees(project.id, {
    ref,
    recursive: true,
    perPage: 100,
    pagination: "offset",
    maxPages: 50,
  } as never)) as Array<{ path: string; type: string; mode: string; id: string }>;
  tree.push(...batch);

  const blobs = tree.filter((e) => e.type === "blob");
  const matching = blobs.filter((b) => isIncluded(b.path, cfg.include_globs, cfg.exclude_globs));

  const out: RepoFile[] = [];
  for (const b of matching) {
    try {
      const file = (await client.RepositoryFiles.show(project.id, b.path, ref)) as {
        content: string;
        encoding: string;
        size: number;
        blob_id: string;
      };
      const body = file.encoding === "base64"
        ? Buffer.from(file.content, "base64").toString("utf8")
        : file.content;
      // Cap individual file size at 1MB to keep the catalog DB lean.
      if (body.length > 1_000_000) continue;
      out.push({
        path: b.path,
        language: languageFor(b.path),
        size_bytes: file.size,
        body,
        blob_sha: file.blob_id ?? b.id,
      });
    } catch {
      // Per-file failures shouldn't kill the whole sync.
      continue;
    }
  }
  return { files: out, default_branch: ref };
}

function makeClient(cfg: GitLabSourceConfig): InstanceType<typeof Gitlab> {
  const token = cfg.token_ref ? process.env[cfg.token_ref] : undefined;
  return new Gitlab({
    host: cfg.base_url,
    token: token ?? "",
  });
}

function isIncluded(path: string, includes: string[], excludes: string[]): boolean {
  if (excludes.some((g) => minimatch(path, g, { matchBase: true, dot: true }))) return false;
  if (includes.length === 0) return true;
  return includes.some((g) => minimatch(path, g, { matchBase: true, dot: true }));
}

function languageFor(path: string): string | null {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    sql: "sql",
    md: "markdown",
    yaml: "yaml",
    yml: "yaml",
    json: "json",
    sh: "shell",
    go: "go",
    rs: "rust",
    java: "java",
    rb: "ruby",
  };
  return map[ext] ?? null;
}
