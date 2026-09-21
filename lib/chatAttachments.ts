import type {SupabaseClient} from '@supabase/supabase-js';
import type {ChatAuthResult} from './chatAuth';
import {canAccessChatRoom,canWriteChatRoom} from './chatAccess';
import {readPublicRoomState} from './chatAdmin';
import {findChatMember,CHAT_UUID} from './chatMembers';
import {parseChatRoom} from './publicChat';
export const CHAT_ATTACHMENT_BUCKET='chat-attachments';
export class AttachmentError extends Error {constructor(message:string,public status=400){super(message);}}
export function attachmentIds(value:unknown):string[]{
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.length>3||value.some(id=>typeof id!=='string'||!CHAT_UUID.test(id))||new Set(value).size!==value.length)throw new AttachmentError('Attach up to three files.');
 return value;
}
export async function attachmentAccess(db:SupabaseClient,auth:Extract<ChatAuthResult,{ok:true}>,scope:{room_slug?:string|null;conversation_id?:string|null},write=false){
 const member=await findChatMember(db,auth.user.id);if(!member)throw new AttachmentError('Choose your chat name first.',403);
 if(scope.room_slug&&scope.conversation_id)throw new AttachmentError('Choose one conversation or room.');
 if(scope.conversation_id){
  if(!CHAT_UUID.test(scope.conversation_id)||!canAccessChatRoom(auth.access,'social'))throw new AttachmentError('File unavailable.',404);
  const result=await db.from('longboard_chat_conversations').select('id,requester_id,recipient_id,status').eq('id',scope.conversation_id).or(`requester_id.eq.${member.id},recipient_id.eq.${member.id}`).maybeSingle();
  if(result.error)throw new AttachmentError('Files unavailable.',503);
  const conversation=result.data;if(!conversation)throw new AttachmentError('File unavailable.',404);
  if(write){
   if(conversation.status!=='accepted')throw new AttachmentError('Accept the request before sharing files.',409);
   const other=conversation.requester_id===member.id?conversation.recipient_id:conversation.requester_id;
   const blocks=await db.from('longboard_chat_blocks').select('blocker_id').in('blocker_id',[member.id,other]).in('blocked_id',[member.id,other]).limit(1);
   if(blocks.error)throw new AttachmentError('Files unavailable.',503);
   if(blocks.data?.length)throw new AttachmentError('Messaging is unavailable for this conversation.',409);
  }
 }else if(scope.room_slug){
  const room=parseChatRoom(scope.room_slug);if(!room||!canAccessChatRoom(auth.access,room))throw new AttachmentError('File unavailable.',404);
  if(write&&!canWriteChatRoom(auth.access,room))throw new AttachmentError(room==="gainers"?"Gainers is a read-only broadcast channel.":"Only admins can attach files in announcement channels.",403);
  if(write&&!(await readPublicRoomState(db,room)).isOpen)throw new AttachmentError('This room is paused.',423);
 }else throw new AttachmentError('Choose a room.');
 return member;
}
