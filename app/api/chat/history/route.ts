import { NextRequest, NextResponse } from "next/server";
import { requireChatUser } from "@/lib/chatAuth";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { canAccessChatRoom } from "@/lib/chatAccess";
import { parseChatRoom } from "@/lib/publicChat";
export const dynamic="force-dynamic";
export async function GET(req:NextRequest) {
 const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
 const auth=await requireChatUser(req);
 if(!auth.ok) return json({error:auth.error},auth.status);
 const room=parseChatRoom(req.nextUrl.searchParams.get("room"));
 if(!room) return json({error:"invalid_room"},400);
 if(!canAccessChatRoom(auth.access,room)) return json({error:"room_forbidden"},403);
 const admin=createChatAdminClient();
 if(!admin) return json({error:"unavailable"},503);
 const messages=await admin.from("longboard_chat_messages").select("id,room_slug,guest_id,member_id,author_label,body,bot_slug,reply_to_id,created_at,edited_at")
  .eq("room_slug",room).order("created_at",{ascending:false}).limit(60);
 if(messages.error) return json({error:"unavailable"},503);
 const ids=(messages.data??[]).map(m=>m.id);
 const reactions=ids.length?await admin.from("longboard_chat_reactions").select("message_id,guest_id,active,created_at,updated_at").in("message_id",ids):{data:[],error:null};
 if(reactions.error) return json({error:"unavailable"},503);
 return json({messages:(messages.data??[]).reverse(),reactions:reactions.data??[]});
}
