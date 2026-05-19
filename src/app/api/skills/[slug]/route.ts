import { NextRequest, NextResponse } from "next/server";
import { deleteSkill, getSkill } from "@/lib/catalog/skills";
import { audit } from "@/lib/catalog/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const skill = await getSkill(slug);
  if (!skill) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ skill });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  await deleteSkill(slug);
  await audit("user", "skill:delete", slug);
  return NextResponse.json({ ok: true });
}
