import { NextResponse } from "next/server";
import { catalogPool } from "@/lib/catalog/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const convId = url.searchParams.get("conversation_id");

  const rows = await catalogPool.query<{
    id: number;
    conversation_id: string | null;
    slug: string;
    name: string;
    description: string;
    triggers: string[];
    body_md: string;
    created_at: string;
  }>(
    convId
      ? `SELECT id, conversation_id, slug, name, description, triggers, body_md, created_at
           FROM skill_candidates
          WHERE status = 'pending' AND conversation_id = $1
          ORDER BY created_at DESC LIMIT 5`
      : `SELECT id, conversation_id, slug, name, description, triggers, body_md, created_at
           FROM skill_candidates
          WHERE status = 'pending'
          ORDER BY created_at DESC LIMIT 5`,
    convId ? [convId] : [],
  );
  return NextResponse.json({ candidates: rows.rows });
}
