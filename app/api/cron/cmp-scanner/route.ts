import { NextRequest, NextResponse } from "next/server";
import { getCachedCmpScan } from "@/lib/scanners/cmpScanner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SESSION_START_MINUTES_ET = 4 * 60;
const SESSION_END_MINUTES_ET = 20 * 60;

function authorizeCron(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 500 });
  const authHeader = req.headers.get("authorization") ?? "";
  if (authHeader !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return null;
}

function inExtendedSession(now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  if (get("weekday") === "Sat" || get("weekday") === "Sun") return false;
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  return minutes >= SESSION_START_MINUTES_ET && minutes < SESSION_END_MINUTES_ET;
}

// Every 2 minutes (vercel.json). Reading the cached scan refreshes it in the
// background once it is stale, so there is one scan per tick at most.
export async function GET(req: NextRequest) {
  const unauthorized = authorizeCron(req);
  if (unauthorized) return unauthorized;
  if (!inExtendedSession(new Date()) && req.nextUrl.searchParams.get("force") !== "1") {
    return NextResponse.json({ ok: true, skipped: "outside_extended_hours" });
  }

  try {
    const scan = await getCachedCmpScan();
    return NextResponse.json({
      ok: true,
      servedFetchedAt: scan.fetchedAt,
      rows: scan.rows.length,
      errors: scan.errors.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "cmp_scan_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
