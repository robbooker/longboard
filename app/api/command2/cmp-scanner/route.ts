import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCachedCmpScan } from "@/lib/scanners/cmpScanner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = "no-store";

// Members read the one shared cached scan; this route never starts a scan per tab.
export async function GET() {
  const auth = await getCurrentUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: { "Cache-Control": NO_STORE } });
  }

  try {
    const scan = await getCachedCmpScan();
    return NextResponse.json(scan, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown scanner error.";
    return NextResponse.json({ error: message }, { status: 500, headers: { "Cache-Control": NO_STORE } });
  }
}
