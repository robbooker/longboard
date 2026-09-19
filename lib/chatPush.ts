import webpush from 'web-push';
import {randomUUID} from 'node:crypto';
import {createChatAdminClient} from '@/lib/chatAdmin';
export type ChatPushSubscription={endpoint:string;keys:{p256dh:string;auth:string}};
/** Provider-owned HTTPS destinations only: no arbitrary URLs, ports or credentials. */
export function validPushEndpoint(value:unknown):value is string {
 if(typeof value!=='string'||value.length>2048)return false;
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.hash&&((u.hostname==='fcm.googleapis.com'&&u.pathname.startsWith('/fcm/send/'))||(u.hostname==='updates.push.services.mozilla.com'&&u.pathname.startsWith('/wpush/'))||(u.hostname==='web.push.apple.com'&&u.pathname.startsWith('/'))); }catch{return false;}
}
export function parsePushSubscription(value:unknown):ChatPushSubscription|null {
 if(!value||typeof value!=='object')return null;const s=value as ChatPushSubscription;
 if(!validPushEndpoint(s.endpoint)||!s.keys||typeof s.keys.p256dh!=='string'||typeof s.keys.auth!=='string')return null;
 if(!/^[A-Za-z0-9_-]{87}$/.test(s.keys.p256dh)||Buffer.from(s.keys.p256dh,'base64url').length!==65||Buffer.from(s.keys.p256dh,'base64url')[0]!==4||!/^[A-Za-z0-9_-]{22}$/.test(s.keys.auth))return null;
 return {endpoint:s.endpoint,keys:{p256dh:s.keys.p256dh,auth:s.keys.auth}};
}
export function pushConfiguration(){const publicKey=process.env.CHAT_PUSH_PUBLIC_KEY;const privateKey=process.env.CHAT_PUSH_PRIVATE_KEY;const subject=process.env.CHAT_PUSH_SUBJECT;return publicKey&&privateKey&&subject&&/^(mailto:|https:\/\/)/.test(subject)?{publicKey,privateKey,subject}:null;}
export async function sendChatPush(subscription:ChatPushSubscription,payload:{title:string;body:string;url:string;tag:string}) {
 const config=pushConfiguration();if(!config||!parsePushSubscription(subscription))throw new Error('push_not_configured');
 // web-push makes one HTTPS request; it does not follow redirects.
 return webpush.sendNotification(subscription,JSON.stringify(payload),{vapidDetails:config,TTL:300,urgency:'normal',timeout:8000});
}
/** Per-device jobs prevent retrying successful devices when another provider fails. */
export async function processChatPushJobs(){
 if(!pushConfiguration())return {processed:0};const db=createChatAdminClient();if(!db)throw new Error('push_unavailable');
 const start=Date.now();let processed=0;
 while(processed<20&&Date.now()-start<35000){const worker=randomUUID();const claim=await db.rpc('claim_chat_push_job',{worker});if(claim.error)throw new Error('push_claim_failed');if(!claim.data)break;
 const job=claim.data as {id:string;subscription:ChatPushSubscription;url:string};let outcome='retry';
 try{await sendChatPush(job.subscription,{title:'Longboard Chat',body:'You have a new chat notification.',url:job.url,tag:`chat-${job.id}`});outcome='sent';}catch(error){const status=(error as {statusCode?:number}).statusCode;if(status===404||status===410)outcome='expired';else if(status&&status>=400&&status<500&&status!==429)outcome='discard';}
 const finished=await db.rpc('finish_chat_push_job',{job_id:job.id,worker,outcome});if(finished.error)throw new Error('push_finish_failed');processed++;
 }return {processed};
}
