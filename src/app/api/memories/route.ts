import { NextRequest, NextResponse } from "next/server";
import { insertMemory, listMemories, type MemoryKind, type MemoryScope } from "@/lib/catalog/memories";
import { audit } from "@/lib/catalog/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCOPES: MemoryScope[] = ["user", "workspace"];
const KINDS: MemoryKind[] = ["preference", "fact", "rule", "glossary", "other"];

export async function GET(req: NextRequest) {
  const scope = req.nextUrl.searchParams.get("scope") as MemoryScope | null;
  const rows = await listMemories({
    scope: scope && SCOPES.includes(scope) ? scope : undefined,
    limit: 200,
  });
  return NextResponse.json({ memories: rows });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    scope?: MemoryScope;
    kind?: MemoryKind;
    content?: string;
    importance?: number;
  };
  if (!body.content || !body.content.trim()) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }
  const scope: MemoryScope = SCOPES.includes(body.scope as MemoryScope) ? body.scope! : "user";
  const kind: MemoryKind = KINDS.includes(body.kind as MemoryKind) ? body.kind! : "other";
  const importance =
    typeof body.importance === "number" ? Math.max(1, Math.min(5, body.importance)) : 3;
  const m = await insertMemory({
    scope,
    kind,
    content: body.content,
    importance,
    source: "user",
  });
  await audit("user", "memory:create", String(m.id), { scope, kind, importance });
  return NextResponse.json({ memory: m });
}
