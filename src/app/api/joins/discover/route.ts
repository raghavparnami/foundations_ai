/**
 * Manual trigger for Loop 3 (relationship discovery). Fires the FK backfill,
 * observed-join mining, and name-match passes once. The scheduler will also
 * tick this periodically — this endpoint exists for boot + on-demand
 * inspection.
 */
import { NextResponse } from "next/server";
import { runLoop3 } from "@/lib/worker/loop3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const r = await runLoop3();
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
