import { NextRequest, NextResponse } from "next/server";
import { catalogPool } from "@/lib/catalog/db";
import { upsertSkill } from "@/lib/catalog/skills";
import { audit } from "@/lib/catalog/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST = accept the candidate → write into `skills`, mark candidate accepted.
 * DELETE = dismiss the candidate → mark dismissed (kept for audit trail).
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await catalogPool.query<{
    slug: string;
    name: string;
    description: string;
    triggers: string[];
    body_md: string;
  }>(
    `SELECT slug, name, description, triggers, body_md
       FROM skill_candidates WHERE id = $1 AND status = 'pending'`,
    [id],
  );
  const c = r.rows[0];
  if (!c) return NextResponse.json({ error: "not_found_or_decided" }, { status: 404 });

  const skill = await upsertSkill({
    slug: c.slug,
    name: c.name,
    description: c.description,
    triggers: Array.isArray(c.triggers) ? c.triggers : [],
    body_md: c.body_md,
    enabled: true,
  });

  await catalogPool.query(
    `UPDATE skill_candidates
        SET status = 'accepted', decided_at = NOW()
      WHERE id = $1`,
    [id],
  );
  await audit("user", "skill_candidate:accept", c.slug, { candidate_id: Number(id) });
  return NextResponse.json({ ok: true, skill });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await catalogPool.query<{ slug: string }>(
    `UPDATE skill_candidates
        SET status = 'dismissed', decided_at = NOW()
      WHERE id = $1 AND status = 'pending'
      RETURNING slug`,
    [id],
  );
  if (r.rows[0]) {
    await audit("user", "skill_candidate:dismiss", r.rows[0].slug, { candidate_id: Number(id) });
  }
  return NextResponse.json({ ok: true });
}
