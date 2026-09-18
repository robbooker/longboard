import {audioAccess} from '@/lib/chatAudioAccess';
import {voiceDuration} from '@/lib/chatVoice';
import {createHash,randomUUID} from 'node:crypto';
import {NextRequest,NextResponse} from 'next/server';
import {requireChatUser} from '@/lib/chatAuth';
import {createChatAdminClient,requestOriginAllowed} from '@/lib/chatAdmin';
import {CHAT_UUID} from '@/lib/chatMembers';
import {attachmentAccess,AttachmentError,CHAT_ATTACHMENT_BUCKET} from '@/lib/chatAttachments';
import {attachmentSignature,type ChatFileType} from '@/lib/chatAttachmentValidation';
import {scanAttachment,MalwareScanError} from '@/lib/chatMalwareScan';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers});
type Context={params:Promise<{id:string}>};
async function context(req:NextRequest,ctx:Context,write=false){
 if(write&&!requestOriginAllowed(req))throw new AttachmentError('Origin not allowed.',403);
 const auth=await requireChatUser(req);if(!auth.ok)throw new AttachmentError(auth.error,auth.status);
 const {id}=await ctx.params;if(!CHAT_UUID.test(id))throw new AttachmentError('File unavailable.',404);
 const db=createChatAdminClient();if(!db)throw new AttachmentError('Files unavailable.',503);
 const {data:file,error}=await db.from('chat_attachments').select('*').eq('id',id).maybeSingle();
 if(error)throw new AttachmentError('Files unavailable.',503);
 if(!file)throw new AttachmentError('File unavailable.',404);
 const member=await attachmentAccess(db,auth,file,write);
 if(write&&member.id!==file.member_id)throw new AttachmentError('File unavailable.',404);
 return {db,file};
}
function failure(e:unknown){return json({error:e instanceof AttachmentError||e instanceof MalwareScanError?e.message:'File operation unavailable. Please try again.'},e instanceof AttachmentError?e.status:503);}
export async function POST(req:NextRequest,ctx:Context){
 try{
  const {db,file}=await context(req,ctx,true);
  if(file.status==='ready')return json({ready:true});
  if(file.status!=='pending')throw new AttachmentError(file.status==='scanning'?'This file is still being scanned.':'Select this file again to retry.',409);
  if(Date.now()-Date.parse(file.created_at)>2*60*60*1000)throw new AttachmentError('This upload expired. Select it again.',410);
  const token=randomUUID(),path=`clean/${randomUUID()}`;
  const claimed=await db.from('chat_attachments').update({status:'scanning',scan_token:token,scan_started_at:new Date().toISOString(),object_path:path}).eq('id',file.id).eq('status','pending').select('id').maybeSingle();
  if(claimed.error)throw new AttachmentError('File scanning unavailable.',503);
  if(!claimed.data)throw new AttachmentError('This file is already being processed.',409);
  try{
   const stored=await db.storage.from(CHAT_ATTACHMENT_BUCKET).download(file.upload_path);
   if(stored.error||!stored.data)throw new AttachmentError('Upload incomplete. Select the file again.');
   if(stored.data.size!==file.byte_size)throw new AttachmentError('Uploaded size does not match the selected file.');
   const bytes=new Uint8Array(await stored.data.arrayBuffer());
   if(!attachmentSignature(bytes,file.mime_type as ChatFileType))throw new AttachmentError('The file contents do not match its type.');
   const duration=file.mime_type==='audio/wav'?voiceDuration(bytes):null;
   await scanAttachment(bytes,file.mime_type);
   // Store the exact scanned buffer at a new server-only key. Never promote the
   // mutable quarantine path or trust an object that changed during the scan.
   const clean=await db.storage.from(CHAT_ATTACHMENT_BUCKET).upload(path,bytes,{contentType:file.mime_type,upsert:false,cacheControl:'0'});
   if(clean.error)throw new AttachmentError('Could not save the scanned file. Select it again.',503);
   const saved=await db.from('chat_attachments').update({status:'ready',...(duration!==null?{duration_seconds:duration}:{}),sha256:createHash('sha256').update(bytes).digest('hex'),scan_token:null}).eq('id',file.id).eq('status','scanning').eq('scan_token',token).select('id').maybeSingle();
   if(saved.error||!saved.data)throw new AttachmentError('Upload was cancelled. Select the file again.',409);
   return json({ready:true});
  }catch(e){
   await db.from('chat_attachments').update({status:'rejected',scan_token:null}).eq('id',file.id).eq('status','scanning').eq('scan_token',token);
   throw e;
  }
 }catch(e){return failure(e);}
}
export async function GET(req:NextRequest,ctx:Context){
 try{
  const {db,file}=await context(req,ctx);
  if(file.status!=='attached'||(!file.room_message_id&&!file.dm_message_id)||!file.object_path)throw new AttachmentError('File unavailable.',404);
  const linked=await (file.conversation_id
   ?db.from('longboard_chat_direct_messages').select('id').eq('id',file.dm_message_id).eq('conversation_id',file.conversation_id).is('deleted_at',null)
   :db.from('longboard_chat_messages').select('id').eq('id',file.room_message_id).eq('room_slug',file.room_slug)).contains('attachment_ids',[file.id]).maybeSingle();
  if(linked.error)throw new AttachmentError('Files unavailable.',503);
  if(!linked.data)throw new AttachmentError('File unavailable.',404);
  if(file.mime_type==='audio/wav')await audioAccess(req,file.id);
  const preview=(req.nextUrl.searchParams.get('preview')==='1'&&file.mime_type.startsWith('image/'))||(req.nextUrl.searchParams.get('play')==='1'&&file.mime_type==='audio/wav');
  const signed=await db.storage.from(CHAT_ATTACHMENT_BUCKET).createSignedUrl(file.object_path,60,preview?{}:{download:file.filename});
  if(signed.error)throw new AttachmentError('File unavailable.',503);
  return new NextResponse(null,{status:302,headers:{...headers,Location:signed.data.signedUrl}});
 }catch(e){return failure(e);}
}
export async function DELETE(req:NextRequest,ctx:Context){
 try{
  const {db,file}=await context(req,ctx);
  if(!requestOriginAllowed(req))throw new AttachmentError('Origin not allowed.',403);
  // Cancellation requires ownership but remains possible while a room is paused.
  const auth=await requireChatUser(req);if(!auth.ok)throw new AttachmentError(auth.error,auth.status);
  const member=await attachmentAccess(db,auth,file);
  if(member.id!==file.member_id)throw new AttachmentError('File unavailable.',404);
  const removed=await db.from('chat_attachments').delete().eq('id',file.id).neq('status','attached');
  if(removed.error)throw new AttachmentError('Could not remove file.',503);
  return json({ok:true});
 }catch(e){return failure(e);}
}
