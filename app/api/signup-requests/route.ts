import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// In-memory rate limit: 3 requests per IP per rolling hour. Acceptable for
// v1 because Vercel serverless instances are short-lived — abuse that
// spreads across cold starts won't be caught, which is fine for invite-only.
const RATE_LIMIT = 3;
const WINDOW_MS = 60 * 60 * 1000;
const hits = new Map<string, number[]>();

function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const prev = hits.get(ip) ?? [];
  const recent = prev.filter((t) => now - t < WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  return false;
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);

  if (isRateLimited(ip)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: { email?: unknown; message?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (typeof body.email !== "string" || !EMAIL_RE.test(body.email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  const email = body.email.trim().toLowerCase();
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 2000) : null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Dedup: existing pending row for this email → write a duplicate row so
  // admin still sees the re-request (and its message/IP), but don't surface
  // the duplication to the caller. Not leaking whether an email is already
  // on file is an intentional info-leak dodge.
  const { data: existingPending } = await admin
    .from("signup_requests")
    .select("id")
    .eq("status", "pending")
    .ilike("email", email)
    .limit(1)
    .maybeSingle();

  const status = existingPending ? "duplicate" : "pending";
  const userAgent = req.headers.get("user-agent")?.slice(0, 512) ?? null;

  await admin.from("signup_requests").insert({
    email,
    message,
    status,
    source_ip: ip === "unknown" ? null : ip,
    user_agent: userAgent,
  });

  // Always 200 with the same body — no dupe signal, no DB-error signal.
  return NextResponse.json({ ok: true });
}
