import { NextRequest, NextResponse } from "next/server";
import { listSkills, upsertSkill } from "@/lib/catalog/skills";
import { audit } from "@/lib/catalog/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const skills = await listSkills();
  return NextResponse.json({ skills });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    slug: string;
    name: string;
    description: string;
    triggers: string[];
    body_md: string;
    enabled?: boolean;
  };
  const slug = sanitizeSlug(body.slug || body.name);
  if (!slug) return NextResponse.json({ error: "Invalid slug" }, { status: 400 });

  const skill = await upsertSkill({
    slug,
    name: (body.name ?? slug).trim(),
    description: (body.description ?? "").trim(),
    triggers: Array.isArray(body.triggers) ? body.triggers.map(String) : [],
    body_md: body.body_md ?? "",
    enabled: body.enabled,
  });
  await audit("user", "skill:upsert", slug, { triggers: skill.triggers.length });
  return NextResponse.json({ skill });
}

function sanitizeSlug(raw: string): string | null {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return /^[a-z][a-z0-9-]{1,60}$/.test(s) ? s : null;
}
