import type {NextRequest} from 'next/server';
import {requireChatUser} from './chatAuth';
import {createChatAdminClient} from './chatAdmin';
import {attachmentAccess,AttachmentError} from './chatAttachments';
import {CHAT_UUID} from './chatMembers';
export async function audioAccess(req:NextRequest,id:string){
 const auth=await requireChatUser(req);if(!auth.ok)throw new AttachmentError(auth.error,auth.status);
 if(!CHAT_UUID.test(id))throw new AttachmentError('Voice message unavailable.',404);
 const db=createChatAdminClient();if(!db)throw new AttachmentError('Voice messages unavailable.',503);
 const {data:file,error}=await db.from('chat_attachments').select('*').eq('id',id).maybeSingle();
 if(error)throw new AttachmentError('Voice messages unavailable.',503);
 if(!file||file.status!=='attached'||file.mime_type!=='audio/wav'||!file.object_path)throw new AttachmentError('Voice message unavailable.',404);
 const member=await attachmentAccess(db,auth,file);
 if(file.conversation_id){
  const conversation=await db.from('longboard_chat_conversations').select('requester_id,recipient_id,status').eq('id',file.conversation_id).maybeSingle();
  if(conversation.error)throw new AttachmentError('Voice messages unavailable.',503);
  if(!conversation.data||conversation.data.status!=='accepted')throw new AttachmentError('Voice message unavailable.',404);
  const pair=[conversation.data.requester_id,conversation.data.recipient_id];
  const blocked=await db.from('longboard_chat_blocks').select('blocker_id').in('blocker_id',pair).in('blocked_id',pair).limit(1);
  if(blocked.error)throw new AttachmentError('Voice messages unavailable.',503);
  if(blocked.data?.length)throw new AttachmentError('Voice message unavailable.',404);
 }
 const linked=await(file.conversation_id?db.from('longboard_chat_direct_messages').select('id').eq('id',file.dm_message_id).eq('conversation_id',file.conversation_id).is('deleted_at',null):db.from('longboard_chat_messages').select('id').eq('id',file.room_message_id).eq('room_slug',file.room_slug)).contains('attachment_ids',[id]).maybeSingle();
 if(linked.error)throw new AttachmentError('Voice messages unavailable.',503);
 if(!linked.data)throw new AttachmentError('Voice message unavailable.',404);
 return {db,file,member};
}
