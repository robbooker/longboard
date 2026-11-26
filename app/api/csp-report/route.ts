// #519 Content security policy, watch-only stage: where browsers send "this would have been
// blocked" reports (see lib/contentSecurityPolicy.mjs). No sign-in: a browser sends these on its
// own. Every outcome is a quiet 204, so nothing here can show up as an error anywhere; the only
// record is one short `csp-report {...}` log line per new finding. No database.
import { NextRequest, NextResponse } from "next/server";
import { ChatTimingRateLimit } from "@/lib/chatTimings";
import { CSP_REPORT_LOG_PREFIX, CSP_REPORT_MAX_BODY, CspReportSampler, parseCspReports } from "@/lib/cspReport";

export const dynamic = "force-dynamic";

/** 30 report posts per caller per 10 minutes, per server instance. */
const limiter = new ChatTimingRateLimit(30, 10 * 60_000);
const sampler = new CspReportSampler();
const TYPES = ["application/csp-report", "application/reports+json", "application/json"];

const quiet = () => new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });

function callerKey(req: NextRequest) {
  const forwarded = req.headers.get("x-forwarded-for");
  return (forwarded ? forwarded.split(",")[0].trim() : req.headers.get("x-real-ip")) || "unknown";
}

/** The body as text, or null as soon as it passes the limit (whatever Content-Length claimed). */
async function smallBody(req: NextRequest): Promise<string | null> {
  const reader = req.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let size = 0;
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > CSP_REPORT_MAX_BODY) {
      void reader.cancel().catch(() => {});
      return null;
    }
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

export async function POST(req: NextRequest) {
  try {
    const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!TYPES.includes(type)) return quiet();
    if (Number(req.headers.get("content-length") ?? 0) > CSP_REPORT_MAX_BODY) return quiet();
    if (!limiter.allow(callerKey(req))) return quiet();
    const raw = await smallBody(req);
    if (!raw) return quiet();
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    for (const line of parseCspReports(raw, host)) {
      if (sampler.shouldLog(line)) console.log(`${CSP_REPORT_LOG_PREFIX} ${JSON.stringify(line)}`);
    }
  } catch {}
  return quiet();
}
