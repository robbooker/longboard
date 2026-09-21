import { NextRequest, NextResponse } from "next/server";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { verifyShortScoutMembership } from "@/lib/shortscoutMembership";
import { validChatLoginSecret, chatSecretHash, newChatLoginSecret } from "@/lib/chatLoginProof";
import { SHORTSCOUT_SITE } from "@/lib/chatLoginConfig";
import {shortscoutRoomRequiresMastermind} from "@/lib/shortscoutPolicy";
export const dynamic = "force-dynamic";
const headers = {"Access-Control-Allow-Origin":SHORTSCOUT_SITE,"Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type, Authorization","Cache-Control":"no-store","Vary":"Origin"};
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers});
export function OPTIONS(req:NextRequest) {
  return new NextResponse(null,{status:req.headers.get("origin")===SHORTSCOUT_SITE?204:403,headers});
}
export async function POST(req:NextRequest) {
  if(req.headers.get("origin")!==SHORTSCOUT_SITE) return json({error:"origin_not_allowed"},403);
  const payload=await req.json().catch(()=>null);
  if(!validChatLoginSecret(payload?.state)) return json({error:"invalid_login"},400);
  const header=req.headers.get("authorization")??"";
  if(!header.startsWith("Bearer ")) return json({error:"session_required"},401);
  const admin=createChatAdminClient();
  if(!admin) return json({error:"login_unavailable"},503);
  const stateHash=chatSecretHash(payload.state);
  const pending=await admin.from("chat_login_requests").select("state_hash,return_room,expected_subject").eq("state_hash",stateHash)
    .is("code_hash",null).is("consumed_at",null).gt("expires_at",new Date().toISOString()).maybeSingle();
  if(pending.error) return json({error:"login_unavailable"},503);
  if(!pending.data) return json({error:"login_expired"},400);
  const member=await verifyShortScoutMembership(header.slice(7));
  if(!member.ok) return json({error:member.reason},member.reason==="unavailable"?503:member.reason==="invalid_session"?401:403);
  if(pending.data.expected_subject && pending.data.expected_subject!==member.subject)return json({error:"identity_mismatch",message:"Sign in with the ShortScout account used for your original chat profile."},403);
  if(shortscoutRoomRequiresMastermind(pending.data.return_room)&&member.level!=="mastermind")return json({error:"insufficient_membership"},403);
  const code=newChatLoginSecret();
  const result=await admin.from("chat_login_requests").update({subject:member.subject,membership_level:member.level,code_hash:chatSecretHash(code)})
    .eq("state_hash",stateHash).is("code_hash",null).is("consumed_at",null).gt("expires_at",new Date().toISOString()).select("state_hash").maybeSingle();
  if(result.error) return json({error:"login_unavailable"},503);
  if(!result.data) return json({error:"login_expired"},400);
  return json({code});
}
