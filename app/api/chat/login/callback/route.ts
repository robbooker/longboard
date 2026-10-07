import { chatLoginRecoveryReason } from "@/lib/chatLoginRecovery";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createChatAdminClient } from "@/lib/chatAdmin";
import {
  validChatLoginSecret,
  chatSecretHash,
  chatLoginChallenge,
  newChatLoginSecret,
} from "@/lib/chatLoginProof";
import {
  CHAT_LOGIN_COOKIE,
  CHAT_SESSION_COOKIE,
  CHAT_SESSION_MAX_AGE,
  chatCookieOptions,
} from "@/lib/chatLoginConfig";
import { verifyCurrentShortScoutAuthorization } from "@/lib/chatShortScoutAuthorization";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const state = req.nextUrl.searchParams.get("state");
  const code = req.nextUrl.searchParams.get("code");
  const [cookieState, verifier] = (req.cookies.get(CHAT_LOGIN_COOKIE)?.value ?? "").split(".");
  const fail = (error: string) => {
    const target = new URL("/chat/login/recovery", req.url);
    target.searchParams.set("reason", chatLoginRecoveryReason(error));
    const response = NextResponse.redirect(target);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.cookies.set(CHAT_LOGIN_COOKIE, "", { ...chatCookieOptions, maxAge: 0 });
    return response;
  };
  if (
    !validChatLoginSecret(state) ||
    !validChatLoginSecret(code) ||
    state !== cookieState ||
    !validChatLoginSecret(verifier)
  )
    return fail("invalid_login_handoff");
  const admin = createChatAdminClient();
  if (!admin) return fail("login_unavailable");
  const pending = await admin
    .from("chat_login_requests")
    .select("link_user_id")
    .eq("state_hash", chatSecretHash(state))
    .maybeSingle();
  if (pending.error || !pending.data) return fail("login_expired");
  let linkUser: string | null = null;
  if (pending.data.link_user_id) {
    const auth = await getCurrentUser();
    if (!auth.ok || auth.user.id !== pending.data.link_user_id) return fail("link_session_changed");
    linkUser = auth.user.id;
  }
  const session = newChatLoginSecret();
  const handoff = {
    p_state_hash: chatSecretHash(state),
    p_code_hash: chatSecretHash(code),
    p_challenge: chatLoginChallenge(verifier),
    p_link_user_id: linkUser,
  };
  const start = await admin.rpc("begin_chat_login_authorization", handoff);
  if (
    start.error ||
    !start.data ||
    typeof start.data.subject !== "string" ||
    !Number.isSafeInteger(start.data.generation)
  )
    return fail(start.error?.message ?? "login_unavailable");
  const proof = await verifyCurrentShortScoutAuthorization(start.data.subject);
  const { data, error } = await admin.rpc("finish_chat_login_authorization", {
    ...handoff,
    p_session_hash: chatSecretHash(session),
    p_generation: start.data.generation,
    p_state: proof.state,
    p_level: proof.level,
  });
  if (error || !data || data.error) return fail(error?.message ?? data?.error ?? "invalid_login_handoff");
  if (data.sessionMaxAge !== CHAT_SESSION_MAX_AGE) return fail("login_unavailable");
  const target = new URL(data.membershipBridge ? "/chat/login/connected" : "/chat", req.url);
  target.searchParams.set("room", data.room);
  if (data.popout) target.searchParams.set("popout", "1");
  const response = NextResponse.redirect(target);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.cookies.set(CHAT_SESSION_COOKIE, session, { ...chatCookieOptions, maxAge: CHAT_SESSION_MAX_AGE });
  response.cookies.set(CHAT_LOGIN_COOKIE, "", { ...chatCookieOptions, maxAge: 0 });
  return response;
}
