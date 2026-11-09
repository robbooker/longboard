import { NextRequest, NextResponse } from "next/server";
import { createChatAdminClient, requestOriginAllowed } from "@/lib/chatAdmin";
import { CHAT_SESSION_COOKIE, CHAT_SESSION_MAX_AGE, chatCookieOptions } from "@/lib/chatLoginConfig";
import { chatSecretHash, newChatLoginSecret } from "@/lib/chatLoginProof";
import { GAINERS_PATH, suggestedName, supabaseWelcomeStore, validWelcomeToken, welcomeTokenHash } from "@/lib/members/welcome";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

const STATUS: Record<string, number> = { invalid: 404, used: 410, expired: 410, session_used: 410, longboard_account: 409, no_access: 403, no_purchase: 404 };

/**
 * #390: the welcome link's button. Only this POST uses the token up (the page a link opens never
 * does, so an email scanner that opens links can't spend it). It makes or links the club chat
 * account and sets the same chat session cookie the code sign-in sets.
 */
export async function POST(request: NextRequest) {
  if (!requestOriginAllowed(request)) return json({ error: "origin_not_allowed" }, 403);
  const payload = await request.json().catch(() => null);
  const token = payload?.t;
  if (!validWelcomeToken(token)) return json({ error: "invalid" }, 404);
  const db = createChatAdminClient();
  if (!db) return json({ error: "unavailable" }, 503);
  const session = newChatLoginSecret();
  let result;
  try {
    result = await supabaseWelcomeStore(db).redeem(welcomeTokenHash(token), chatSecretHash(session), new Date(Date.now() + CHAT_SESSION_MAX_AGE * 1000));
  } catch {
    return json({ error: "unavailable" }, 503);
  }
  if (!result || result.status !== "ok") {
    const status = result?.status ?? "unavailable";
    return json({ error: status }, STATUS[status] ?? 503);
  }
  const response = json({ ok: true, needsName: result.member !== true, name: suggestedName(result.name), next: GAINERS_PATH });
  response.cookies.set(CHAT_SESSION_COOKIE, session, { ...chatCookieOptions, maxAge: CHAT_SESSION_MAX_AGE });
  return response;
}
