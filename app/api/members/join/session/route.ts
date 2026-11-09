import { NextRequest, NextResponse } from "next/server";
import { createChatAdminClient, requestOriginAllowed } from "@/lib/chatAdmin";
import { CHECKOUT_SESSION_RE } from "@/lib/members/join";
import { CHECKOUT_TOKENS_PER_HOUR, checkoutSignIn, issueWelcomeToken, supabaseWelcomeStore } from "@/lib/members/welcome";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

const STATUS: Record<string, number> = { pending: 404, too_old: 410, linked: 409, session_used: 410, longboard_account: 409, no_access: 403 };

/**
 * #390: the thank-you page's one-tap button. The Stripe checkout session id from the success URL
 * is weaker proof than the purchase email, so it works only within 2 hours of the purchase, only
 * while the buyer has no chat account yet, and gives one sign-in per session. It answers a fresh
 * 15-minute welcome token, which the page spends at /api/members/join/welcome like an email link.
 */
export async function POST(request: NextRequest) {
  if (!requestOriginAllowed(request)) return json({ error: "origin_not_allowed" }, 403);
  const payload = await request.json().catch(() => null);
  const sessionId = payload?.session_id;
  if (typeof sessionId !== "string" || !CHECKOUT_SESSION_RE.test(sessionId)) return json({ error: "invalid_session_id" }, 400);
  const db = createChatAdminClient();
  if (!db) return json({ error: "unavailable" }, 503);
  const store = supabaseWelcomeStore(db);
  try {
    const check = await checkoutSignIn(store, sessionId);
    if (!check.ok) return json({ error: check.reason }, STATUS[check.reason] ?? 403);
    const since = new Date(Date.now() - 60 * 60 * 1000);
    if ((await store.countTokens({ sessionId }, "checkout", since)) >= CHECKOUT_TOKENS_PER_HOUR) return json({ error: "too_many_tries" }, 429);
    const token = await issueWelcomeToken(store, { id: check.personId, email: check.email }, "checkout", sessionId);
    return json({ token });
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
