import {NextRequest,NextResponse} from 'next/server';
import {createChatAdminClient} from '@/lib/chatAdmin';
import {CHAT_ATTACHMENT_BUCKET} from '@/lib/chatAttachments';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET(req:NextRequest){
 const secret=process.env.CRON_SECRET;
 if(!secret||req.headers.get('authorization')!==`Bearer ${secret}`)return NextResponse.json({error:'Unauthorized'},{status:401});
 const db=createChatAdminClient();if(!db)return NextResponse.json({error:'Cleanup unavailable'},{status:503});
 try{
  const usage=await db.from('chat_attachment_daily_usage').delete().lt('day',new Date(Date.now()-7*86400000).toISOString().slice(0,10));
  if(usage.error)throw usage.error;
  // Bounded batches; triggers persist deletion work even if this process stops.
  const stale=await db.from('chat_attachments').select('id').neq('status','attached').lt('created_at',new Date(Date.now()-24*60*60*1000).toISOString()).limit(100);
  if(stale.error)throw stale.error;
  if(stale.data.length){const deleted=await db.from('chat_attachments').delete().in('id',stale.data.map(f=>f.id)).neq('status','attached');if(deleted.error)throw deleted.error;}
  const due=await db.from('chat_attachment_deletions').select('path').lte('not_before',new Date().toISOString()).order('not_before').limit(100);
  if(due.error)throw due.error;
  if(due.data.length){
   const paths=due.data.map(f=>f.path);
   const removed=await db.storage.from(CHAT_ATTACHMENT_BUCKET).remove(paths);if(removed.error)throw removed.error;
   const ack=await db.from('chat_attachment_deletions').delete().in('path',paths);if(ack.error)throw ack.error;
  }
  return NextResponse.json({deleted:due.data.length},{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'Cleanup failed; queued files will retry.'},{status:503});}
}
