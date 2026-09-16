import {NextRequest,NextResponse} from "next/server";
import {createChatAdminClient,requestOriginAllowed} from "@/lib/chatAdmin";
import {CHAT_SESSION_COOKIE,chatCookieOptions} from "@/lib/chatLoginConfig";
import {validChatLoginSecret,chatSecretHash} from "@/lib/chatLoginProof";
export async function POST(req:NextRequest) {
 if(!requestOriginAllowed(req)) return NextResponse.json({error:"origin_not_allowed"},{status:403});
 const token=req.cookies.get(CHAT_SESSION_COOKIE)?.value;
 if(validChatLoginSecret(token)) {
  const admin=createChatAdminClient();
  if(!admin) return NextResponse.json({error:"unavailable"},{status:503});
  const {error}=await admin.from("chat_sessions").update({revoked_at:new Date().toISOString()}).eq("token_hash",chatSecretHash(token));
  if(error) return NextResponse.json({error:"unavailable"},{status:503});
 }
 const response=NextResponse.json({ok:true},{headers:{"Cache-Control":"no-store"}});
 response.cookies.set(CHAT_SESSION_COOKIE,"",{...chatCookieOptions,maxAge:0});
 return response;
}
