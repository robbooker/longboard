import {NextRequest,NextResponse} from 'next/server';
import {requireChatUser} from '@/lib/chatAuth';
import {createChatAdminClient,requestOriginAllowed} from '@/lib/chatAdmin';
import {CHAT_UUID} from '@/lib/chatMembers';
import {scannerConfigured} from '@/lib/chatMalwareScan';
import {attachmentMetadata} from '@/lib/chatAttachmentValidation';
import {attachmentAccess,AttachmentError,CHAT_ATTACHMENT_BUCKET} from '@/lib/chatAttachments';
export const dynamic='force-dynamic';
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function POST(req:NextRequest){
 if(!requestOriginAllowed(req))return json({error:'Origin not allowed.'},403);
 const auth=await requireChatUser(req);if(!auth.ok)return json({error:auth.error},auth.status);
 const db=createChatAdminClient();if(!db)return json({error:'Uploads unavailable.'},503);
 // Do not accept uploads unless a scanner has been configured.
 if(!scannerConfigured())return json({error:'File scanning is not configured yet. Please try again later.'},503);
 try{
  const body=await req.json();
  const metadata=attachmentMetadata(body?.filename,body?.mime_type,body?.byte_size);
  if((typeof body.room==='string')===(typeof body.conversationId==='string'))throw new AttachmentError('Choose a room or conversation.');
  const scope={room_slug:body.room,conversation_id:body.conversationId};
  const member=await attachmentAccess(db,auth,scope,true);
  const {data:file,error}=await db.rpc(scope.conversation_id?'reserve_chat_dm_attachment':'reserve_chat_attachment',{sender:member.id,...(scope.conversation_id?{conversation:scope.conversation_id}:{room:scope.room_slug}),name:metadata.filename,mime:metadata.mime_type,bytes:metadata.byte_size});
  if(error||!file)throw new AttachmentError(error?.message==='attachment_rate_limited'?'Upload limit reached. Try again tomorrow.':'Upload unavailable.',error?.message==='attachment_rate_limited'?429:503);
  const signed=await db.storage.from(CHAT_ATTACHMENT_BUCKET).createSignedUploadUrl(file.upload_path,{upsert:false});
  if(signed.error)throw new AttachmentError('Upload unavailable.',503);
  return json({id:file.id,url:signed.data.signedUrl});
 }catch(e){return json({error:e instanceof Error?e.message:'Invalid upload.'},e instanceof AttachmentError?e.status:400);}
}

export async function GET(req:NextRequest){
 const auth=await requireChatUser(req);if(!auth.ok)return json({error:auth.error},auth.status);
 const db=createChatAdminClient();if(!db)return json({error:'Files unavailable.'},503);
 try{
  const room=req.nextUrl.searchParams.get('room');
  const conversation=req.nextUrl.searchParams.get('conversationId');
  if(Boolean(room)===Boolean(conversation))throw new AttachmentError('Choose a room or conversation.');
  await attachmentAccess(db,auth,{room_slug:room,conversation_id:conversation});
  const ids=(req.nextUrl.searchParams.get('ids')||'').split(',');
  if(ids.length>60||new Set(ids).size!==ids.length||ids.some(id=>!CHAT_UUID.test(id)))throw new AttachmentError('Invalid files.');
  const files=await db.from('chat_attachments').select('id,filename,mime_type,byte_size,room_message_id,dm_message_id,duration_seconds,preview_width,preview_height,preview_unavailable').eq(conversation?'conversation_id':'room_slug',conversation||room!).eq('status','attached').in('id',ids);
  if(files.error)throw new AttachmentError('Files unavailable.',503);
  if(files.data.length){
   const query=conversation
    ?db.from('longboard_chat_direct_messages').select('id,attachment_ids').eq('conversation_id',conversation).is('deleted_at',null)
    :db.from('longboard_chat_messages').select('id,attachment_ids').eq('room_slug',room!);
   const messages=await query.in('id',files.data.map(file=>conversation?file.dm_message_id:file.room_message_id));
   if(messages.error)throw new AttachmentError('Files unavailable.',503);
   files.data=files.data.filter(file=>messages.data.some(message=>message.id===(conversation?file.dm_message_id:file.room_message_id)&&message.attachment_ids?.includes(file.id)));
  }
  return json({files:files.data.map(file=>({id:file.id,filename:file.filename,mime_type:file.mime_type,byte_size:file.byte_size,duration_seconds:file.duration_seconds,preview_width:file.preview_width,preview_height:file.preview_height,thumbnail_available:file.mime_type.startsWith('image/')&&!file.preview_unavailable}))});
 }catch(e){return json({error:e instanceof AttachmentError?e.message:'Files unavailable.'},e instanceof AttachmentError?e.status:503);}
}
