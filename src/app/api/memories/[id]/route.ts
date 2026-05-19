import { NextRequest, NextResponse } from "next/server";
import { deleteMemory, updateMemory } from "@/lib/catalog/memories";
import { audit } from "@/lib/catalog/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json()) as {
    content?: string;
    importance?: number;
    scope?: "user" | "workspace";
    kind?: "preference" | "fact" | "rule" | "glossary" | "other";
    enabled?: boolean;
    status?: string;
  };
  const m = await updateMemory(Number(id), body);
  if (!m) return NextResponse.json({ error: "not_found" }, { status: 404 });
  await audit("user", "memory:update", String(m.id), body);
  return NextResponse.json({ memory: m });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await deleteMemory(Number(id));
  await audit("user", "memory:delete", id);
  return NextResponse.json({ ok: true });
}
