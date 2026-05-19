/**
 * GitLab repository registration. The body must include the GitLab project
 * path (e.g. "group/sub/project") and optionally a token env-var name —
 * we never accept the token directly in HTTP traffic; you set the env in
 * .env.local and reference its name here.
 *
 * POST returns immediately; the code-wiki agent picks up the new source
 * on its next tick (or you can hit /api/wiki/code-sources/[id]/sync to
 * force an immediate sync).
 */
import { NextRequest, NextResponse } from "next/server";
import { catalogPool } from "@/lib/catalog/db";
import { audit } from "@/lib/catalog/queries";
import { runCodeWiki } from "@/lib/worker/wiki/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const r = await catalogPool.query<{
    id: number;
    provider: string;
    display_name: string;
    project_path: string;
    base_url: string;
    default_branch: string;
    last_synced_at: string | null;
    status: string;
    file_count: string;
  }>(
    `SELECT s.id, s.provider, s.display_name, s.project_path, s.base_url,
            s.default_branch, s.last_synced_at::text AS last_synced_at, s.status,
            (SELECT count(*)::text FROM code_files f WHERE f.code_source_id = s.id) AS file_count
       FROM code_sources s
       ORDER BY s.id`,
  );
  return NextResponse.json({
    sources: r.rows.map((s) => ({ ...s, file_count: Number(s.file_count) })),
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    provider?: "gitlab" | "github";
    display_name?: string;
    project_path?: string;
    base_url?: string;
    token_ref?: string;
    default_branch?: string;
    include_globs?: string[];
    exclude_globs?: string[];
  };

  const provider = body.provider ?? "gitlab";
  if (provider !== "gitlab") {
    return NextResponse.json({ error: "Only gitlab is supported in v0.1." }, { status: 400 });
  }
  if (!body.project_path || !body.display_name) {
    return NextResponse.json({ error: "display_name and project_path are required" }, { status: 400 });
  }

  const r = await catalogPool.query<{ id: number }>(
    `INSERT INTO code_sources (provider, display_name, project_path, base_url, token_ref, default_branch, include_globs, exclude_globs)
       VALUES ($1, $2, $3, COALESCE($4, 'https://gitlab.com'), $5, COALESCE($6, 'main'), COALESCE($7::jsonb, '["**/*.md","**/*.ts","**/*.py","**/*.sql"]'::jsonb), COALESCE($8::jsonb, '["node_modules/**","dist/**","build/**",".git/**"]'::jsonb))
     ON CONFLICT (provider, project_path) DO UPDATE
        SET display_name = EXCLUDED.display_name,
            base_url = EXCLUDED.base_url,
            token_ref = EXCLUDED.token_ref,
            default_branch = EXCLUDED.default_branch,
            include_globs = EXCLUDED.include_globs,
            exclude_globs = EXCLUDED.exclude_globs,
            status = 'pending'
     RETURNING id`,
    [
      provider,
      body.display_name,
      body.project_path,
      body.base_url ?? null,
      body.token_ref ?? null,
      body.default_branch ?? null,
      body.include_globs ? JSON.stringify(body.include_globs) : null,
      body.exclude_globs ? JSON.stringify(body.exclude_globs) : null,
    ],
  );
  const id = r.rows[0]!.id;
  await audit("user", "wiki:code_source_register", body.display_name, { id, project_path: body.project_path });

  // Fire the code-wiki agent immediately so the user sees their repo indexed.
  void runCodeWiki().catch(() => {});

  return NextResponse.json({ ok: true, id });
}
