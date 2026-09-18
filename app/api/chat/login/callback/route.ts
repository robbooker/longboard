import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { validChatLoginSecret, chatSecretHash, chatLoginChallenge, newChatLoginSecret } from "@/lib/chatLoginProof";
import { CHAT_LOGIN_COOKIE, CHAT_SESSION_COOKIE, chatCookieOptions } from "@/lib/chatLoginConfig";
export const dynamic = "force-dynamic";
export async function GET(req:NextRequest) {
  const state=req.nextUrl.searchParams.get("state");
  const code=req.nextUrl.searchParams.get("code");
  const [cookieState,verifier]=(req.cookies.get(CHAT_LOGIN_COOKIE)?.value??"").split(".");
  const fail=(error:string)=>NextResponse.json({error},{status:400,headers:{"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
  if(!validChatLoginSecret(state)||!validChatLoginSecret(code)||state!==cookieState||!validChatLoginSecret(verifier)) return fail("invalid_login_handoff");
  const admin=createChatAdminClient();
  if(!admin) return fail("login_unavailable");
  const pending=await admin.from("chat_login_requests").select("link_user_id").eq("state_hash",chatSecretHash(state)).maybeSingle();
  if(pending.error||!pending.data) return fail("login_expired");
  let linkUser:string|null=null;
  if(pending.data.link_user_id) {
    const auth=await getCurrentUser();
    if(!auth.ok||auth.user.id!==pending.data.link_user_id) return fail("link_session_changed");
    linkUser=auth.user.id;
  }
  const session=newChatLoginSecret();
  const {data,error}=await admin.rpc("consume_chat_login",{p_state_hash:chatSecretHash(state),p_code_hash:chatSecretHash(code),p_challenge:chatLoginChallenge(verifier),p_link_user_id:linkUser,p_session_hash:chatSecretHash(session)});
  if(error||!data) return fail(error?.message==="insufficient_membership"?"insufficient_membership":error?.message.includes("identity_already_linked")?"identity_already_linked":"invalid_login_handoff");
  const target=new URL("/chat",req.url);
  target.searchParams.set("room",data.room);
  if(data.popout) target.searchParams.set("popout","1");
  const response=NextResponse.redirect(target);
  response.headers.set("Cache-Control","no-store");
  response.headers.set("Referrer-Policy","no-referrer");
  response.cookies.set(CHAT_SESSION_COOKIE,session,{...chatCookieOptions,maxAge:43200});
  response.cookies.set(CHAT_LOGIN_COOKIE,"",{...chatCookieOptions,maxAge:0});
  return response;
}
