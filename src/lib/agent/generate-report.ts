/**
 * Implementation of the `generate_report` agent tool. Persists a markdown
 * report in the catalog and returns a download URL the UI can render as a
 * chip the user clicks to fetch the .md file.
 */
import { catalogPool } from "../catalog/db";
import { audit } from "../catalog/queries";

export type GenerateReportInput = {
  title: string;
  body_md: string;
  slug?: string;
  conversationId: string;
};

export type GenerateReportResult =
  | { ok: true; slug: string; title: string; download_url: string; bytes: number }
  | { ok: false; error: string };

export async function generateReport(input: GenerateReportInput): Promise<GenerateReportResult> {
  const title = input.title.trim();
  if (!title) return { ok: false, error: "title is required" };
  const body = input.body_md.trim();
  if (!body) return { ok: false, error: "body_md is required" };

  const slug = sanitizeSlug(input.slug || title) || `report-${Date.now()}`;

  const r = await catalogPool.query<{ id: number; slug: string }>(
    `INSERT INTO reports (slug, title, body_md, conversation_id)
       VALUES ($1, $2, $3, $4)
     ON CONFLICT (slug) DO UPDATE
        SET title = EXCLUDED.title,
            body_md = EXCLUDED.body_md,
            conversation_id = EXCLUDED.conversation_id,
            created_at = now()
     RETURNING id, slug`,
    [slug, title, body, input.conversationId],
  );
  const row = r.rows[0]!;
  await audit("agent", "generate_report", row.slug, {
    conversationId: input.conversationId,
    bytes: body.length,
  });

  return {
    ok: true,
    slug: row.slug,
    title,
    download_url: `/api/reports/${row.slug}/download`,
    bytes: body.length,
  };
}

function sanitizeSlug(raw: string): string | null {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return /^[a-z0-9][a-z0-9-]{1,80}$/.test(s) ? s : null;
}
