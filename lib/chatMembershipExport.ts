import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {CHAT_UUID} from './chatMembers';
import {isPaidShortScoutLevel} from './shortscoutPolicy';

const ENDPOINT='https://xejuximbbpnzqylukrsn.supabase.co/functions/v1/chat-membership-export';
const TTL=60_000, RETRY=5_000, MAX_ENTRIES=5000;
type Entry={paid:boolean;expires:number};
type Options={key:()=>string|undefined;request?:typeof fetch;now?:()=>number};
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
const signature=(key:string,text:string)=>createHmac('sha256',key).update(text).digest('hex');

/** Server-only display data. Never use this consumer or its cache for authorization. */
export function createMembershipExportConsumer({key,request=fetch,now=Date.now}:Options){
 const cache=new Map<string,Entry>(),pending=new Map<string,Promise<void>>();
 let activeKey:string|undefined;
 const store=(subject:string,value:Entry)=>{cache.delete(subject);cache.set(subject,value);while(cache.size>MAX_ENTRIES)cache.delete(cache.keys().next().value!);};
 async function refresh(subjects:string[],secret:string){
  const started=now(),timestamp=String(Math.floor(started/1000)),nonce=randomBytes(16).toString('hex');
  const body=JSON.stringify({version:1,subjects});
  try{
   const response=await request(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json','x-chat-membership-timestamp':timestamp,'x-chat-membership-nonce':nonce,'x-chat-membership-signature':signature(secret,`request\n${timestamp}\n${nonce}\n${body}`)},body,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});
   if(response.status!==200||!response.body)throw Error('unavailable');
   const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
   try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536)throw Error('oversize');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
   const raw=Buffer.concat(chunks).toString('utf8');
   const stamp=response.headers.get('x-chat-membership-timestamp')??'',mac=response.headers.get('x-chat-membership-signature')??'';
   if(!/^\d{10}$/.test(stamp)||Math.abs(now()-Number(stamp)*1000)>TTL||now()-started>=TTL||!/^[a-f0-9]{64}$/.test(mac))throw Error('stale');
   if(!timingSafeEqual(Buffer.from(mac,'hex'),Buffer.from(signature(secret,`response\n${stamp}\n${nonce}\n${raw}`),'hex')))throw Error('signature');
   const data=JSON.parse(raw);
   if(data?.version!==1||data.nonce!==nonce||data.requestDigest!==digest(body)||!Array.isArray(data.records)||data.records.length!==subjects.length)throw Error('envelope');
   const rows=new Map<string,boolean>();
   for(const row of data.records){
    if(!row||!subjects.includes(row.subject)||rows.has(row.subject))throw Error('subject');
    const paid=row.state==='update'&&isPaidShortScoutLevel(row.level);
    if(!paid&&!(row.state==='revoke'&&row.level==='free')&&!(row.state==='delete'&&row.level===null))throw Error('state');
    rows.set(row.subject,paid);
   }
   // Key rotation must not allow an old in-flight response into the new cache.
   if(activeKey===secret)for(const [subject,paid] of rows)store(subject,{paid,expires:started+TTL});
  }catch{
   // Expired positive results never survive a failed refresh. A short cooldown bounds retries.
   if(activeKey===secret)for(const subject of subjects)store(subject,{paid:false,expires:now()+RETRY});
  }
 }
 return async(subjects:string[]):Promise<Set<string>>=>{
  const secret=key();
  if(secret!==activeKey){cache.clear();activeKey=secret;}
  if(!secret||Buffer.byteLength(secret)<32)return new Set();
  const ids=[...new Set(subjects.filter(subject=>CHAT_UUID.test(subject)&&subject===subject.toLowerCase()))];
  const missing=ids.filter(subject=>!pending.has(subject)&&(!cache.has(subject)||cache.get(subject)!.expires<=now()));
  for(let i=0;i<missing.length;i+=200){
   const batch=missing.slice(i,i+200);
   const task=refresh(batch,secret).finally(()=>{for(const subject of batch)if(pending.get(subject)===task)pending.delete(subject);});
   for(const subject of batch)pending.set(subject,task);
  }
  await Promise.all(ids.map(subject=>pending.get(subject)));
  if(activeKey!==secret)return new Set();
  return new Set(ids.filter(subject=>{const row=cache.get(subject);return row?.paid&&row.expires>now();}));
 };
}
// Each server process has its own bounded, short-lived cache. Nothing is persisted as an entitlement.
export const currentShortScoutBadgeSubjects=createMembershipExportConsumer({key:()=>process.env.CHAT_MEMBERSHIP_EXPORT_KEY});
