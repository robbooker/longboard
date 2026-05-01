import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Phase 3O — public Kit V4 subscribe endpoint for the bubbles home and
// /thanks flow. Lives alongside (not replacing) /api/newsletter/subscribe,
// which writes to Supabase. This route only talks to Kit; the form ID is
// the daily brief's signup form. Lift to env if we ever change forms.
const KIT_FORM_ID = "9392050";
const KIT_ENDPOINT = `https://api.kit.com/v4/forms/${KIT_FORM_ID}/subscribers`;

// Same loose-but-adequate email regex used in /api/newsletter/subscribe.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  const apiKey = process.env.KIT_API_KEY;
  if (!apiKey) {
    console.error("subscribe: KIT_API_KEY missing from env");
    return NextResponse.json({ error: "configuration_error" }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_email" }, { status: 400 });
  }

  const email = typeof (body as { email?: unknown })?.email === "string"
    ? ((body as { email: string }).email).trim().toLowerCase()
    : "";
  if (!email || !EMAIL_RE.test(email) || email.length > 320) {
    return NextResponse.json({ ok: false, error: "invalid_email" }, { status: 400 });
  }

  let kitRes: Response;
  try {
    kitRes = await fetch(KIT_ENDPOINT, {
      method: "POST",
      headers: {
        "X-Kit-Api-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email_address: email }),
    });
  } catch (err) {
    console.error("subscribe: Kit fetch failed:", err);
    return NextResponse.json({ ok: false, error: "subscription_failed" }, { status: 502 });
  }

  if (kitRes.status === 200 || kitRes.status === 201) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // Anything in 4xx is a client-side problem (most often Kit rejecting
  // the email format itself — they're stricter than our regex). Surface
  // it as invalid_email so the form can show the typo prompt.
  if (kitRes.status >= 400 && kitRes.status < 500) {
    const detail = await kitRes.text().catch(() => "");
    console.warn(`subscribe: Kit ${kitRes.status} for ${email}: ${detail.slice(0, 200)}`);
    return NextResponse.json({ ok: false, error: "invalid_email" }, { status: 400 });
  }

  // 5xx or anything unexpected.
  const detail = await kitRes.text().catch(() => "");
  console.error(`subscribe: Kit ${kitRes.status}: ${detail.slice(0, 200)}`);
  return NextResponse.json({ ok: false, error: "subscription_failed" }, { status: 502 });
}
