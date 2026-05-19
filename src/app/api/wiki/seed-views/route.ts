import { NextResponse } from "next/server";
import { seedViewsForSource } from "@/lib/worker/loop4-seed-views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const r = await seedViewsForSource(1);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
