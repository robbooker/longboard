import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { newChatLoginSecret, chatSecretHash, chatLoginChallenge } from "@/lib/chatLoginProof";
import { CHAT_LOGIN_COOKIE, chatCookieOptions, SHORTSCOUT_SITE } from "@/lib/chatLoginConfig";
import { parseChatRoom } from "@/lib/publicChat";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const admin = createChatAdminClient();
  if (!admin) return NextResponse.json({error:"login_unavailable"},{status:503});
  const link = req.nextUrl.searchParams.get("link") === "1";
  const auth = link ? await getCurrentUser() : null;
  if (link && !auth?.ok) return NextResponse.redirect(new URL("/login?next=%2Fchat",req.url));
  const state = newChatLoginSecret();
  const verifier = newChatLoginSecret();
  const {error} = await admin.from("chat_login_requests").insert({
    state_hash:chatSecretHash(state), challenge:chatLoginChallenge(verifier),
    link_user_id:auth?.ok ? auth.user.id : null,
    return_room:parseChatRoom(req.nextUrl.searchParams.get("room")) ?? "shortscout",
    popout:req.nextUrl.searchParams.get("popout")==="1",
  });
  if (error) return NextResponse.json({error:"login_unavailable"},{status:503});
  const target = new URL("/chat-connect",SHORTSCOUT_SITE);
  target.searchParams.set("state",state);
  // Only this explicit second entrance opts into the new callback origin.
  // Existing hosts keep the legacy handoff unchanged. Never trust a query origin.
  if (req.nextUrl.origin === "https://chat.robbooker.com") {
    target.searchParams.set("chat_origin", "https://chat.robbooker.com");
  }
  const response = NextResponse.redirect(target);
  response.headers.set("Cache-Control","no-store");
  response.headers.set("Referrer-Policy","no-referrer");
  response.cookies.set(CHAT_LOGIN_COOKIE,`${state}.${verifier}`,{...chatCookieOptions,maxAge:300});
  return response;
}
