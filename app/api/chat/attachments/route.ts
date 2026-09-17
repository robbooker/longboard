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
  if(typeof body.room!=='string'||body.conversationId)throw new AttachmentError('Choose a room.');
  const scope={room_slug:body.room};
  const member=await attachmentAccess(db,auth,scope,true);
  const {data:file,error}=await db.rpc('reserve_chat_attachment',{sender:member.id,room:scope.room_slug,name:metadata.filename,mime:metadata.mime_type,bytes:metadata.byte_size});
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
  if(!room)throw new AttachmentError('Choose a room.');
  await attachmentAccess(db,auth,{room_slug:room});
  const ids=(req.nextUrl.searchParams.get('ids')||'').split(',');
  if(ids.length>3||ids.some(id=>!CHAT_UUID.test(id)))throw new AttachmentError('Invalid files.');
  const files=await db.from('chat_attachments').select('id,filename,mime_type,byte_size,room_message_id').eq('room_slug',room).eq('status','attached').in('id',ids);
  if(files.error)throw new AttachmentError('Files unavailable.',503);
  return json({files:files.data.map(file=>({id:file.id,filename:file.filename,mime_type:file.mime_type,byte_size:file.byte_size}))});
 }catch(e){return json({error:e instanceof AttachmentError?e.message:'Files unavailable.'},e instanceof AttachmentError?e.status:503);}
}
