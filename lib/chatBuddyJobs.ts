import { randomUUID } from 'node:crypto';
import { createChatAdminClient } from '@/lib/chatAdmin';
import { answerBuddy, type BuddyContextMessage } from '@/lib/chatBuddy';

/** Bounded worker; SQL owns claiming, current authorization and atomic completion. */
export async function processBuddyJobs({messageId,limit=2}:{messageId?:string;limit?:number}={}) {
 const db=createChatAdminClient();
 if(!db)throw new Error('buddy_worker_unavailable');
 const started=Date.now();
 let processed=0;
 for(let i=0;i<Math.min(2,Math.max(0,limit));i++) {
  if(Date.now()-started>28000)break;
  const worker=randomUUID();
  const claim=await db.rpc('claim_chat_buddy_job',{worker,source:messageId??null});
  if(claim.error)throw new Error('buddy_claim_failed');
  if(!claim.data)break;
  const job=claim.data as {messageId:string;body:string;createdAt:string};
  let text:string|null=null;
  try {
   const context=await db.from('longboard_chat_messages').select('author_label,body,bot_slug')
    .eq('room_slug','main').lt('created_at',job.createdAt).order('created_at',{ascending:false}).limit(12);
   if(context.error)throw new Error('buddy_context_unavailable');
   const reply=await answerBuddy(job.body,((context.data??[]) as BuddyContextMessage[]).reverse(),AbortSignal.timeout(25000));
   text=reply.text.length>600?`${reply.text.slice(0,599).trimEnd()}…`:reply.text;
  }catch { /* Safe retry state; never persist or expose provider details. */ }
  const finish=await db.rpc('finish_chat_buddy_job',{source:job.messageId,worker,answer:text});
  if(finish.error)throw new Error('buddy_finish_failed');
  processed++;
  if(messageId)break;
 }
 return {processed};
}
