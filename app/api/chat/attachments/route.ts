import {NextRequest,NextResponse} from 'next/server';
import {requireChatUser} from '@/lib/chatAuth';
import {createChatAdminClient,requestOriginAllowed} from '@/lib/chatAdmin';
import {attachmentMetadata} from '@/lib/chatAttachmentValidation';
import {attachmentAccess,AttachmentError,CHAT_ATTACHMENT_BUCKET} from '@/lib/chatAttachments';
export const dynamic='force-dynamic';
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function POST(req:NextRequest){
 if(!requestOriginAllowed(req))return json({error:'Origin not allowed.'},403);
 const auth=await requireChatUser(req);if(!auth.ok)return json({error:auth.error},auth.status);
 const db=createChatAdminClient();if(!db)return json({error:'Uploads unavailable.'},503);
 // Do not accept uploads unless a scanner has been configured.
 if(!process.env.CHAT_MALWARE_SCAN_URL||!process.env.CHAT_MALWARE_SCAN_KEY)return json({error:'File scanning is not configured yet. Please try again later.'},503);
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
