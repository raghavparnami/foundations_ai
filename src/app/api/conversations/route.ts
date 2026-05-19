/**
 * Recent conversation list — now sourced from the `conversations` table
 * (real persisted threads with stable titles), with a fallback to audit_log
 * for conversations that pre-date the messages table.
 */
import { NextResponse } from "next/server";
import { listConversations } from "@/lib/catalog/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const conversations = await listConversations(30);
  return NextResponse.json({
    conversations: conversations.map((c) => ({
      id: c.slug,
      title: c.title,
      project_slug: c.project_slug,
      last_ts: c.updated_at,
      turns: c.turn_count,
    })),
  });
}
