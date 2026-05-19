import { NextResponse } from "next/server";
import { discoverDomains } from "@/lib/worker/wiki/domains";
import { runDomainIndexBuilder } from "@/lib/worker/wiki/domain-index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const d = await discoverDomains();
    const i = await runDomainIndexBuilder();
    return NextResponse.json({ ok: true, ...d, indexes_generated: i.generated });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e), stack: (e as Error).stack }, { status: 500 });
  }
}
