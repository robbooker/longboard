import {randomUUID} from 'node:crypto';
import {NextRequest,NextResponse} from 'next/server';
import {requestOriginAllowed} from '@/lib/chatAdmin';
import {audioAccess} from '@/lib/chatAudioAccess';
import {AttachmentError,CHAT_ATTACHMENT_BUCKET} from '@/lib/chatAttachments';
import {voiceDuration} from '@/lib/chatVoice';
import {transcribeVoice} from '@/lib/chatTranscription';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
type Context={params:Promise<{id:string}>};
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
const failure=(e:unknown)=>json({error:e instanceof AttachmentError?e.message:'Transcription is unavailable. You can still play the recording. Try again later.'},e instanceof AttachmentError?e.status:503);
export async function GET(req:NextRequest,ctx:Context){try{
 const {id}=await ctx.params;const {db}=await audioAccess(req,id);
 const result=await db.from('chat_audio_transcripts').select('status,text').eq('attachment_id',id).maybeSingle();if(result.error)throw Error('unavailable');
 return json(result.data?.status==='ready'?{status:'ready',text:result.data.text}:{status:result.data?.status??'none'});
}catch(e){return failure(e);}}
export async function POST(req:NextRequest,ctx:Context){
 if(!requestOriginAllowed(req))return json({error:'Origin not allowed.'},403);
 try{
  const {id}=await ctx.params;const {db,file,member}=await audioAccess(req,id);
  if(!process.env.OPENAI_API_KEY)throw Error('unavailable');
  const token=randomUUID(),claim=await db.rpc('claim_chat_transcript',{actor:member.id,file_id:id,token});
  if(claim.error)throw new AttachmentError(/limit/.test(claim.error.message)?'Transcription limit reached. Try later or listen to the recording.':'Voice message unavailable.',/limit/.test(claim.error.message)?429:404);
  if(claim.data.status==='ready')return json(claim.data);
  if(claim.data.status!=='claimed')return json({status:'processing'},202);
  try{
   const stored=await db.storage.from(CHAT_ATTACHMENT_BUCKET).download(file.object_path);if(stored.error||!stored.data||stored.data.size!==file.byte_size)throw Error('unavailable');
   const bytes=new Uint8Array(await stored.data.arrayBuffer());voiceDuration(bytes);
   const text=await transcribeVoice(bytes);
   await audioAccess(req,id); // Fresh membership, block and deletion checks after processing.
   const saved=await db.from('chat_audio_transcripts').update({status:'ready',text,claim_token:null}).eq('attachment_id',id).eq('claim_token',token).eq('status','processing').select('attachment_id').maybeSingle();
   if(saved.error||!saved.data)throw new AttachmentError('Voice message unavailable.',404);
   return json({status:'ready',text});
  }catch(e){await db.from('chat_audio_transcripts').update({status:'failed',claim_token:null}).eq('attachment_id',id).eq('claim_token',token);throw e;}
 }catch(e){return failure(e);}
}
