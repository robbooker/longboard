import { withMessageMemberships } from '@/lib/chatMembershipProjection';
import { NextRequest,NextResponse } from "next/server";

import { canAccessChatRoom } from "@/lib/chatAccess";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { CHAT_UUID } from "@/lib/chatMembers";
import { parseChatRoom } from "@/lib/publicChat";


import type { ChatAuthResult } from '@/lib/chatAuth';
export async function readHistory(req:NextRequest,auth:ChatAuthResult) {
 const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
 if(!auth.ok) return json({error:auth.error},auth.status);
 const room=parseChatRoom(req.nextUrl.searchParams.get("room"));
 if(!room) return json({error:"invalid_room"},400);
 if(!canAccessChatRoom(auth.access,room)) return json({error:"room_forbidden"},403);
 const admin=createChatAdminClient();
 if(!admin) return json({error:"unavailable"},503);
 const messages=await admin.from("longboard_chat_messages").select("id,room_slug,guest_id,member_id,author_label,body,bot_slug,reply_to_id,created_at,edited_at,attachment_ids,client_id,buddy_status,unread_seq")
  .eq("room_slug",room).is("reply_to_id",null).order("created_at",{ascending:false}).limit(80);
 if(messages.error) return json({error:"unavailable"},503);
 const anchor=req.nextUrl.searchParams.get('anchor');
 if(anchor&&!CHAT_UUID.test(anchor))return json({error:'invalid_anchor'},400);
 if(anchor&&!messages.data?.some(m=>m.id===anchor)){
  const retained=await admin.from('longboard_chat_messages').select("id,room_slug,guest_id,member_id,author_label,body,bot_slug,reply_to_id,created_at,edited_at,attachment_ids,client_id,buddy_status,unread_seq").eq('room_slug',room).eq('id',anchor).is('reply_to_id',null).maybeSingle();
  if(retained.error)return json({error:'unavailable'},503);
  if(retained.data)messages.data?.push(retained.data);
 }
 const ids=(messages.data??[]).map(m=>m.id);
 const reactions=ids.length?await admin.from("longboard_chat_reactions").select("message_id,guest_id,active,created_at,updated_at").in("message_id",ids):{data:[],error:null};
 if(reactions.error) return json({error:"unavailable"},503);
 return json({messages:await withMessageMemberships(admin,(messages.data??[]).reverse()),reactions:reactions.data??[]});

}
