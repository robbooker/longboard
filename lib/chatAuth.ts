import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { CHAT_SESSION_COOKIE } from "@/lib/chatLoginConfig";
import { chatSecretHash, validChatLoginSecret } from "@/lib/chatLoginProof";
import type { ChatEntitlements } from "@/lib/chatAccess";
export type ChatAuthResult =
  | {ok:true;user:{id:string;email:string;role:"user"|"admin"};access:ChatEntitlements;serverSession:boolean}
  | {ok:false;status:401|403|503;error:string};

/** Chat identity does not confer access to any Longboard product API. */
export async function requireChatUser(_req?:NextRequest):Promise<ChatAuthResult> {
  const lb=await getCurrentUser();
  const admin=createChatAdminClient();
  if(!admin) return {ok:false,status:503,error:"chat_unavailable"};
  if(lb.ok) {
    const account=await admin.from("chat_accounts").upsert({id:lb.user.id,longboard_user_id:lb.user.id},{onConflict:"id",ignoreDuplicates:true});
    if(account.error) return {ok:false,status:503,error:"chat_unavailable"};
    const {data,error}=await admin.from("chat_provider_identities").select("subject")
      .eq("account_id",lb.user.id).eq("provider","shortscout").gt("verified_at",new Date(Date.now()-43200000).toISOString()).maybeSingle();
    if(error) return {ok:false,status:503,error:"chat_unavailable"};
    const tags=await admin.from("user_tags").select("tag").eq("user_id",lb.user.id).in("tag",["boardroom-cohort-1","boardroom-cohort-2"]).limit(1);
    if(tags.error)return {ok:false,status:503,error:"chat_unavailable"};
    return {ok:true,user:lb.user,access:{boardroom:!!tags.data?.length,longboard:true,shortscout:!!data,admin:lb.user.role==="admin"},serverSession:false};
  }
  const token=(await cookies()).get(CHAT_SESSION_COOKIE)?.value;
  if(!validChatLoginSecret(token)) return {ok:false,status:401,error:"unauthenticated"};
  const session=await admin.from("chat_sessions").select("account_id").eq("token_hash",chatSecretHash(token))
    .is("revoked_at",null).gt("expires_at",new Date().toISOString()).maybeSingle();
  if(session.error) return {ok:false,status:503,error:"chat_unavailable"};
  if(!session.data) return {ok:false,status:401,error:"unauthenticated"};
  const account=await admin.from("chat_accounts").select("id,longboard_user_id").eq("id",session.data.account_id).maybeSingle();
  const identity=await admin.from("chat_provider_identities").select("subject").eq("account_id",session.data.account_id)
    .eq("provider","shortscout").gt("verified_at",new Date(Date.now()-43200000).toISOString()).maybeSingle();
  if(account.error||identity.error) return {ok:false,status:503,error:"chat_unavailable"};
  if(!account.data||!identity.data) return {ok:false,status:401,error:"unauthenticated"};
  let longboard=false;
  let boardroom=false;
  if(account.data.longboard_user_id) {
    const profile=await admin.from("profiles").select("id").eq("id",account.data.longboard_user_id).maybeSingle();
    if(profile.error) return {ok:false,status:503,error:"chat_unavailable"};
    longboard=!!profile.data;
    const tags=await admin.from("user_tags").select("tag").eq("user_id",account.data.longboard_user_id).in("tag",["boardroom-cohort-1","boardroom-cohort-2"]).limit(1);
    if(tags.error)return {ok:false,status:503,error:"chat_unavailable"};
    boardroom=longboard&&!!tags.data?.length;
  }
  return {ok:true,user:{id:account.data.id,email:"",role:"user"},access:{boardroom,longboard,shortscout:true,admin:false},serverSession:true};
}
