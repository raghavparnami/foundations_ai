import { NextRequest, NextResponse } from "next/server";
import { listProjects, upsertProject } from "@/lib/catalog/projects";
import { audit } from "@/lib/catalog/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const projects = await listProjects();
  return NextResponse.json({ projects });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    slug?: string;
    name?: string;
    description?: string | null;
    table_ids?: number[];
  };
  const name = (body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const slug = sanitizeSlug(body.slug || name);
  if (!slug) return NextResponse.json({ error: "invalid slug" }, { status: 400 });

  const project = await upsertProject({
    slug,
    name,
    description: (body.description ?? "").trim() || null,
    table_ids: Array.isArray(body.table_ids) ? body.table_ids.map(Number).filter(Number.isFinite) : [],
  });
  await audit("user", "project:upsert", slug, { tables: project.table_ids.length });
  return NextResponse.json({ project });
}

function sanitizeSlug(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return /^[a-z][a-z0-9-]{1,60}$/.test(s) ? s : null;
}
