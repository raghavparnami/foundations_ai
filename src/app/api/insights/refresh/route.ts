import { NextResponse } from "next/server";
import { extractInsightsForMissingViews } from "@/lib/worker/insights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const r = await extractInsightsForMissingViews();
  return NextResponse.json(r);
}
