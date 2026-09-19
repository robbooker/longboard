import sharp from 'sharp';
import {createHash,randomUUID} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {AttachmentError,CHAT_ATTACHMENT_BUCKET} from './chatAttachments';
import {attachmentSignature,CHAT_FILE_MAX_BYTES,type ChatFileType} from './chatAttachmentValidation';

export const PREVIEW_MAX_BYTES=150_000;
const IMAGE_TYPES=new Set(['image/jpeg','image/png','image/gif']);
// Avoid concurrent large decodes in a single server instance; other instances
// coordinate per attachment via the database lease below.
let active=0;
export async function renderAttachmentPreview(bytes:Uint8Array,mime:string){
 if(!IMAGE_TYPES.has(mime)||bytes.length>CHAT_FILE_MAX_BYTES||!attachmentSignature(bytes,mime as ChatFileType))throw new Error('Unsupported preview');
 if(active>=2)throw new AttachmentError('Preview is being prepared. Try again shortly.',503);
 active++;
 try{
  const image=sharp(bytes,{limitInputPixels:20_000_000,failOn:'warning',pages:1,animated:false,sequentialRead:true});
  const result=await image.rotate().resize({width:640,height:640,fit:'inside',withoutEnlargement:true}).webp({quality:72,effort:2}).timeout({seconds:5}).toBuffer({resolveWithObject:true});
  if(result.data.length>PREVIEW_MAX_BYTES)throw new Error('Preview exceeds size limit');
  return {bytes:result.data,width:result.info.width,height:result.info.height};
 }finally{active--;}
}
export type PreviewFile={id:string;status:string;object_path:string|null;mime_type:string;byte_size:number;sha256:string|null;preview_path?:string|null;preview_width?:number|null;preview_height?:number|null;preview_token?:string|null;preview_started_at?:string|null;preview_unavailable?:boolean};
/** Call only after attachment access and parent checks (or a successful scan).
 * Supplied bytes MUST be the exact buffer that passed scanAttachment.
 */
export async function ensureAttachmentPreview(db:SupabaseClient,file:PreviewFile,scannedBytes?:Uint8Array):Promise<string>{
 if(!IMAGE_TYPES.has(file.mime_type)||!file.object_path||!['scanning','ready','attached'].includes(file.status)||(!scannedBytes&&file.status!=='attached'))throw new AttachmentError('Preview unavailable.',404);
 if(file.preview_path&&file.preview_width&&file.preview_height)return file.preview_path;
 if(file.preview_unavailable)throw new AttachmentError('Preview unavailable.',404);
 if(active>=2)throw new AttachmentError('Preview is being prepared. Try again shortly.',503);
 const token=randomUUID(),path=`previews/${token}.webp`;
 let claim=db.from('chat_attachments').update({preview_token:token,preview_started_at:new Date().toISOString(),preview_path:path,preview_width:null,preview_height:null}).eq('id',file.id).eq('status',file.status).eq('object_path',file.object_path);
 if(file.preview_token){
  if(!file.preview_started_at||Date.parse(file.preview_started_at)>Date.now()-90_000)throw new AttachmentError('Preview is being prepared. Try again shortly.',503);
  claim=claim.eq('preview_token',file.preview_token).eq('preview_started_at',file.preview_started_at);
 }else claim=claim.is('preview_token',null).is('preview_width',null).eq('preview_unavailable',false);
 const claimed=await claim.select('id').maybeSingle();
 if(claimed.error||!claimed.data)throw new AttachmentError('Preview is being prepared. Try again shortly.',503);
 try{
  let bytes=scannedBytes;
  if(!bytes){
   if(!file.sha256||file.byte_size>CHAT_FILE_MAX_BYTES)throw new Error('Invalid clean file');
   const stored=await db.storage.from(CHAT_ATTACHMENT_BUCKET).download(file.object_path,{}, {signal:AbortSignal.timeout(15_000)});
   if(stored.error||!stored.data)throw new AttachmentError('Preview temporarily unavailable.',503);
   if(stored.data.size!==file.byte_size||stored.data.size>CHAT_FILE_MAX_BYTES)throw new Error('Invalid clean size');
   bytes=new Uint8Array(await stored.data.arrayBuffer());
   if(createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw new Error('Clean file changed');
  }
  const preview=await renderAttachmentPreview(bytes,file.mime_type);
  const upload=await db.storage.from(CHAT_ATTACHMENT_BUCKET).upload(path,preview.bytes,{contentType:'image/webp',upsert:false,cacheControl:'0'});
  if(upload.error)throw new AttachmentError('Preview temporarily unavailable.',503);
  const saved=await db.from('chat_attachments').update({preview_width:preview.width,preview_height:preview.height,preview_token:null}).eq('id',file.id).eq('status',file.status).eq('object_path',file.object_path).eq('preview_token',token).select('id').maybeSingle();
  if(saved.error||!saved.data)throw new AttachmentError('Preview unavailable.',404);
  return path;
 }catch(error){
  // Unsafe/unsupported images fail permanently; transient storage/capacity errors
  // can retry. The original is never used as an automatic preview fallback.
  await db.from('chat_attachments').update({preview_token:null,preview_unavailable:!(error instanceof AttachmentError)}).eq('id',file.id).eq('preview_token',token);
  throw error instanceof AttachmentError?error:new AttachmentError('Preview unavailable.',404);
 }
}
