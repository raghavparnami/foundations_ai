/**
 * Code-wiki agent.
 *
 * For each registered code_source (status pending OR last_synced_at > 1h ago):
 *   1. Hit GitLab REST API: list files matching include_globs in the default
 *      branch's tree (recursive). Skip exclude_globs.
 *   2. For each file, pull raw content (size cap 1MB). Compare blob_sha
 *      against the catalog's `code_files.blob_sha`; skip if unchanged.
 *   3. Upsert `code_files` rows.
 *   4. Cluster files into "modules" (top-level directories) and produce one
 *      wiki page per module via the doc-writer LLM.
 *
 * Idempotent + hash-gated end to end. SharePoint is a future origin that
 * lives in the docs corpus, not here — keep code = git repos only.
 */
import { generateText } from "ai";
import { Gitlab } from "@gitbeaker/rest";
import { catalogPool } from "../../catalog/db";
import { upsertWikiPage } from "../../catalog/wiki";
import { audit } from "../../catalog/queries";
import { docWriterModel } from "../openrouter";
import { withRules } from "../rules";

const ACTOR = "wiki-agent:code";
const FILE_SIZE_CAP_BYTES = 1_000_000;

const SYSTEM_PROMPT = `You are Loom's code-corpus summarizer. Given a small
set of source files from a single module/directory of a repository, write a
wiki page in this exact structure:

  ## What this module does
  One paragraph: the role this module plays in the repo.

  ## Public surface
  Bullet list of the most important exports / entry points / scripts the
  reader would invoke. Use \`code\` formatting for symbols.

  ## Dependencies & data
  - external libs of note
  - if the module references Loom catalog tables by name, list them as
    [[tables/<slug>]] cross-refs

  ## When to reference
  2 or 3 bullets describing when an analyst should pull this module into a
  conversation.

Write nothing outside these sections. No preamble.`;

type CodeSource = {
  id: number;
  display_name: string;
  project_path: string;
  base_url: string;
  token_ref: string | null;
  default_branch: string;
  include_globs: string[];
  exclude_globs: string[];
};

export async function runCodeWikiAgent(): Promise<{ generated: number }> {
  const due = await catalogPool.query<CodeSource>(
    `SELECT id, display_name, project_path, base_url, token_ref, default_branch,
            include_globs, exclude_globs
       FROM code_sources
      WHERE status IN ('pending','ready')
        AND (last_synced_at IS NULL OR last_synced_at < NOW() - interval '1 hour')`,
  );

  let generated = 0;
  for (const src of due.rows) {
    try {
      generated += await syncOneSource(src);
    } catch (e) {
      await catalogPool.query(`UPDATE code_sources SET status = 'failed' WHERE id = $1`, [src.id]);
      await audit(ACTOR, "wiki:code_sync_failed", src.display_name, { err: String(e) });
    }
  }
  return { generated };
}

async function syncOneSource(src: CodeSource): Promise<number> {
  await catalogPool.query(`UPDATE code_sources SET status = 'syncing' WHERE id = $1`, [src.id]);

  const token = src.token_ref ? process.env[src.token_ref] : undefined;
  const api = new Gitlab({ host: src.base_url, token });

  // List files in the default branch.
  const tree = (await api.Repositories.allRepositoryTrees(src.project_path, {
    ref: src.default_branch,
    recursive: true,
    perPage: 100,
  })) as Array<{ id: string; name: string; type: string; path: string; mode: string }>;
  const files = tree.filter((node) => node.type === "blob" && matchesGlobs(node.path, src.include_globs, src.exclude_globs));

  // Pull bodies for files whose blob_sha has changed.
  const existing = await catalogPool.query<{ path: string; blob_sha: string }>(
    `SELECT path, blob_sha FROM code_files WHERE code_source_id = $1`,
    [src.id],
  );
  const existingMap = new Map(existing.rows.map((r) => [r.path, r.blob_sha]));

  let changed = 0;
  for (const f of files) {
    if (existingMap.get(f.path) === f.id) continue; // unchanged
    try {
      const body = await api.RepositoryFiles.showRaw(src.project_path, f.path, src.default_branch);
      const text = typeof body === "string" ? body : Buffer.from(body as unknown as ArrayBuffer).toString("utf8");
      if (text.length > FILE_SIZE_CAP_BYTES) continue;
      const language = languageOf(f.path);
      await catalogPool.query(
        `INSERT INTO code_files (code_source_id, path, blob_sha, language, size_bytes, body)
           VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (code_source_id, path) DO UPDATE
            SET blob_sha = EXCLUDED.blob_sha,
                language = EXCLUDED.language,
                size_bytes = EXCLUDED.size_bytes,
                body = EXCLUDED.body,
                indexed_at = NOW()`,
        [src.id, f.path, f.id, language, text.length, text],
      );
      changed++;
    } catch (e) {
      await audit(ACTOR, "wiki:code_file_failed", f.path, { err: String(e) });
    }
  }

  // Drop files that disappeared from the repo.
  const repoPaths = new Set(files.map((f) => f.path));
  const dropped = await catalogPool.query<{ path: string }>(
    `DELETE FROM code_files
      WHERE code_source_id = $1 AND path NOT IN (${repoPaths.size > 0 ? files.map((_, i) => `$${i + 2}`).join(",") : "''"})
      RETURNING path`,
    [src.id, ...files.map((f) => f.path)],
  );
  if (dropped.rowCount && dropped.rowCount > 0) {
    await audit(ACTOR, "wiki:code_files_dropped", src.display_name, { paths: dropped.rows.map((r) => r.path) });
  }

  // Module clustering = top-level directory of each file.
  const byModule = new Map<string, Array<{ path: string; body: string; language: string }>>();
  const allFiles = await catalogPool.query<{ path: string; body: string; language: string | null }>(
    `SELECT path, body, language FROM code_files WHERE code_source_id = $1`,
    [src.id],
  );
  for (const f of allFiles.rows) {
    const mod = topModule(f.path);
    if (!byModule.has(mod)) byModule.set(mod, []);
    byModule.get(mod)!.push({ path: f.path, body: f.body, language: f.language ?? "txt" });
  }

  let pagesGenerated = 0;
  for (const [module, group] of byModule.entries()) {
    const sample = composeModuleSample(group);
    const result = await generateText({
      model: docWriterModel(),
      system: withRules(SYSTEM_PROMPT, "wiki"),
      prompt: `# Repo: ${src.display_name} · Module: ${module}\n\n${sample}`,
      maxRetries: 1,
    });
    const slug = slugify(`${src.display_name}-${module}`);
    const r = await upsertWikiPage(ACTOR, {
      kind: "code",
      slug,
      title: `${src.display_name} / ${module}`,
      summary: firstLineOf(result.text) ?? `Module: ${module}`,
      body_md: result.text.trim(),
      source_ref: {
        code_source_id: src.id,
        module,
        files: group.map((f) => f.path),
      },
    });
    if (r.action !== "skipped") pagesGenerated++;
  }

  await catalogPool.query(
    `UPDATE code_sources SET status = 'ready', last_synced_at = NOW() WHERE id = $1`,
    [src.id],
  );
  await audit(ACTOR, "wiki:code_sync_ok", src.display_name, {
    files_changed: changed,
    modules: byModule.size,
  });

  return pagesGenerated;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function matchesGlobs(path: string, include: string[], exclude: string[]): boolean {
  // Very small glob matcher: supports ** and *. Good enough for the curated
  // default lists.
  const isMatch = (pat: string): boolean => {
    const re = new RegExp(
      "^" +
        pat
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*\*/g, "::DSTAR::")
          .replace(/\*/g, "[^/]*")
          .replace(/::DSTAR::/g, ".*") +
        "$",
    );
    return re.test(path);
  };
  return include.some(isMatch) && !exclude.some(isMatch);
}

function topModule(path: string): string {
  const seg = path.split("/")[0] || "_root";
  return seg;
}

function composeModuleSample(group: { path: string; body: string; language: string }[]): string {
  // Cap total payload to ~12KB so we don't blow the model's context.
  const out: string[] = [];
  let budget = 12000;
  for (const f of group) {
    const head = f.body.slice(0, Math.min(2000, budget));
    if (head.length === 0) break;
    out.push(`### ${f.path}\n\n\`\`\`${f.language}\n${head}\n\`\`\``);
    budget -= head.length;
    if (budget <= 0) break;
  }
  return out.join("\n\n");
}

function languageOf(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    py: "python", rb: "ruby", go: "go", java: "java", kt: "kotlin",
    rs: "rust", sql: "sql", md: "markdown", json: "json", yaml: "yaml",
    yml: "yaml", sh: "bash", html: "html", css: "css", scss: "scss",
  };
  return map[ext] ?? "txt";
}

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return s || `code-${Date.now()}`;
}

function firstLineOf(md: string): string | null {
  for (const line of md.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    return t.slice(0, 200);
  }
  return null;
}
