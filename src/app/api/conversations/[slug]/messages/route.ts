import { NextRequest, NextResponse } from "next/server";
import { loadConversation } from "@/lib/catalog/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params;
  const messages = await loadConversation(slug);
  return NextResponse.json({ messages });
}
