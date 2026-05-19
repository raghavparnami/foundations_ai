import { NextRequest, NextResponse } from "next/server";
import { deleteProject, getProject } from "@/lib/catalog/projects";
import { audit } from "@/lib/catalog/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const project = await getProject(slug);
  if (!project) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ project });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  await deleteProject(slug);
  await audit("user", "project:delete", slug);
  return NextResponse.json({ ok: true });
}
