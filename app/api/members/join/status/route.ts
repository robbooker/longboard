import { NextRequest, NextResponse } from "next/server";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { requireChatUser } from "@/lib/chatAuth";
import { accessHasEntitlement, normalizeEmail } from "@/lib/memberAccess";
import { CHECKOUT_SESSION_RE, joinStatus } from "@/lib/members/join";
import { checkoutSignIn, supabaseWelcomeStore } from "@/lib/members/welcome";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * #384: the club sign-up page asks this every few seconds until the purchase is in (Stripe's
 * webhook can land a few seconds after the thank-you page). ?session_id=cs_... (from Stripe's
 * success URL) or ?email=. "signed_in" when this browser already has club access.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const sessionId = params.get("session_id");
  const email = normalizeEmail(params.get("email"));
  if (sessionId && !CHECKOUT_SESSION_RE.test(sessionId)) return json({ error: "invalid_session_id" }, 400);
  const auth = await requireChatUser(request);
  if (auth.ok && accessHasEntitlement(auth.access, "gainers")) return json({ status: "signed_in" });
  if (!sessionId && !email) return json({ error: "email_required" }, 400);
  const db = createChatAdminClient();
  if (!db) return json({ error: "unavailable" }, 503);
  try {
    const status = await joinStatus(db, sessionId ? { sessionId } : { email: email! });
    // #390: a fresh checkout whose buyer has no chat account yet signs in with one tap, no email.
    if (status.status === "ready" && sessionId) return json({ ...status, oneTap: (await checkoutSignIn(supabaseWelcomeStore(db), sessionId)).ok });
    return json(status);
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
