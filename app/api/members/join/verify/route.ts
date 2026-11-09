import { NextRequest, NextResponse } from "next/server";
import { createChatAdminClient, requestOriginAllowed } from "@/lib/chatAdmin";
import { CHAT_SESSION_COOKIE, CHAT_SESSION_MAX_AGE, chatCookieOptions } from "@/lib/chatLoginConfig";
import { chatSecretHash, newChatLoginSecret } from "@/lib/chatLoginProof";
import { normalizeEmail } from "@/lib/memberAccess";
import { redeemJoinCode } from "@/lib/members/join";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * #384: the emailed code -> a chat sign-in session for the club account (made and linked to the
 * buyer on their first sign-in). The session is the same cookie the ShortScout sign-in sets.
 */
export async function POST(request: NextRequest) {
  if (!requestOriginAllowed(request)) return json({ error: "origin_not_allowed" }, 403);
  const payload = await request.json().catch(() => null);
  const email = normalizeEmail(payload?.email);
  if (!email) return json({ error: "email_required" }, 400);
  const db = createChatAdminClient();
  if (!db) return json({ error: "unavailable" }, 503);
  const checked = await redeemJoinCode(db, email, payload?.code);
  if (checked !== "ok") return json({ error: checked }, checked === "unavailable" ? 503 : 400);
  const session = newChatLoginSecret();
  const { data, error } = await db.rpc("member_open_chat_session", {
    p_email: email,
    p_session_hash: chatSecretHash(session),
    p_expires_at: new Date(Date.now() + CHAT_SESSION_MAX_AGE * 1000).toISOString(),
  });
  if (error || !data) return json({ error: "unavailable" }, 503);
  if (data.status !== "ok") return json({ error: data.status }, data.status === "longboard_account" ? 409 : 403);
  const response = json({ ok: true, needsName: data.member !== true, next: "/chat?room=gainers" });
  response.cookies.set(CHAT_SESSION_COOKIE, session, { ...chatCookieOptions, maxAge: CHAT_SESSION_MAX_AGE });
  return response;
}
