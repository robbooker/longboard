import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Loose but adequate email regex. Catches obvious typos (missing @,
// missing TLD) without rejecting valid but unusual addresses. Real
// deliverability is Resend's problem at send-time, not ours at
// capture-time.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env not configured");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Salted sha256 of the submitter's IP. Salt lives in env so a DB
 *  leak on its own isn't enough to recover IPs via rainbow-table.
 *  Returns null when no salt is configured so missing env doesn't
 *  block signups — the column is nullable by design. */
function hashIp(req: NextRequest): string | null {
  const salt = process.env.NEWSLETTER_IP_SALT;
  if (!salt) return null;
  // x-forwarded-for can be a comma-separated chain from upstream
  // proxies; the first entry is the originating client.
  const xff = req.headers.get("x-forwarded-for");
  const raw = (xff ? xff.split(",")[0].trim() : req.headers.get("x-real-ip")) ?? "";
  if (!raw) return null;
  return createHash("sha256").update(`${salt}:${raw}`).digest("hex");
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  const email = typeof (body as { email?: unknown })?.email === "string"
    ? ((body as { email: string }).email).trim().toLowerCase()
    : "";
  if (!email || !EMAIL_RE.test(email) || email.length > 320) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  const userAgent = req.headers.get("user-agent") ?? null;
  const ipHash = hashIp(req);

  const admin = adminClient();

  // Upsert on email — re-subscribes clear any prior unsubscribed_at
  // and refresh the user_agent/ip_hash pair. Matches the handoff's
  // "200 on duplicate, no extra row" contract.
  const { error } = await admin
    .from("newsletter_subscribers")
    .upsert(
      {
        email,
        source: "daily_homepage",
        user_agent: userAgent,
        ip_hash: ipHash,
        unsubscribed_at: null,
      },
      { onConflict: "email" }
    );

  if (error) {
    console.error("newsletter subscribe failed:", error.message);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
