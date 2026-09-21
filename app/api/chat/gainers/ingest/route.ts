import { createChatAdminClient } from '@/lib/chatAdmin';
import { gainersAuthorized,parseGainersAlert } from '@/lib/chatGainers';
import { NextRequest,NextResponse } from 'next/server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
// A dedicated producer credential, never a member cookie or Supabase credential.
export async function POST(request:NextRequest) {
  const secret=process.env.CHAT_GAINERS_INGEST_TOKEN,channel=process.env.CHAT_GAINERS_TELEGRAM_CHANNEL_ID,start=process.env.CHAT_GAINERS_START_AT;
  if (!secret||secret.length<32||!channel||!start||!Number.isFinite(Date.parse(start))) return json({error:'ingest_not_configured'},503);
  if (!gainersAuthorized(request.headers.get('authorization'),secret)) return json({error:'unauthorized'},401);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')??'')) return json({error:'invalid_content_type'},415);
  // Bound the streamed request too; Content-Length is not authoritative.
  const reader=request.body?.getReader();
  if (!reader) return json({error:'invalid_json'},400);
  const chunks:Uint8Array[]=[];let size=0;
  try { while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>32768){await reader.cancel();return json({error:'payload_too_large'},413);}chunks.push(value);} } catch {return json({error:'invalid_body'},400);}
  let payload:unknown;
  try {payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return json({error:'invalid_json'},400);}
  const alert=parseGainersAlert(payload,channel,start);
  if (!alert) return json({error:'invalid_alert'},400);
  const admin=createChatAdminClient();
  if (!admin) return json({error:'ingest_not_configured'},503);
  try {
  const {data,error}=await admin.rpc('ingest_chat_gainers_alert',{p_channel:alert.sourceChannelId,p_source_id:alert.sourceMessageId,p_posted_at:alert.postedAt,p_body:alert.body});
  if(error){if(error.message.includes('gainers_source_conflict'))return json({error:'source_conflict'},409);return json({error:'ingest_unavailable'},503);}
  return json(data);
  } catch {return json({error:'ingest_unavailable'},503);}
}
