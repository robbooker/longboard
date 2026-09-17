import {NextRequest,NextResponse} from "next/server";
import {requireChatUser} from "@/lib/chatAuth";
import {createChatAdminClient,requestOriginAllowed} from "@/lib/chatAdmin";
import {canAccessChatRoom,canWriteChatRoom} from "@/lib/chatAccess";
import {CHAT_UUID} from "@/lib/chatMembers";
import {parseChatRoom} from "@/lib/publicChat";
export async function POST(req:NextRequest) {
 const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
 if(!requestOriginAllowed(req)) return json({error:"origin_not_allowed"},403);
 const auth=await requireChatUser(req);
 if(!auth.ok) return json({error:auth.error},auth.status);
 const p=await req.json().catch(()=>null);
 const room=parseChatRoom(p?.room);
 if(!p||!room||typeof p.messageId!=="string"||!CHAT_UUID.test(p.messageId)||!["edit","delete"].includes(p.action)) return json({error:"invalid_action"},400);
 if(!canAccessChatRoom(auth.access,room)) return json({error:"room_forbidden"},403);
 if(!canWriteChatRoom(auth.access,room)) return json({error:"Only admins can change announcements."},403);
 if(p.action==="edit"&&(typeof p.body!=="string"||!p.body.trim()||p.body.length>600||typeof p.expectedBody!=="string"||p.expectedBody.length>600)) return json({error:"invalid_message"},400);
 const admin=createChatAdminClient();
 if(!admin) return json({error:"unavailable"},503);
 const {data,error}=await admin.rpc("change_chat_message",{p_actor:auth.user.id,p_message:p.messageId,p_room:room,p_action:p.action,p_body:p.action==="edit"?p.body:null,p_expected_body:p.action==="edit"?p.expectedBody:null,p_admin:auth.user.role==="admin"});
 if(error) {
  const codes:Record<string,number>={room_forbidden:403,message_forbidden:403,message_not_found:404,message_changed:409,chat_paused:423,invalid_message:400};
  return json({error:codes[error.message]?error.message:"message_update_failed"},codes[error.message]??503);
 }
 return json(p.action==="delete"?data:{message:data});
}
