import type {createChatAdminClient} from './chatAdmin';
import {verifyCurrentShortScoutAuthorization} from './chatShortScoutAuthorization';

type Admin=NonNullable<ReturnType<typeof createChatAdminClient>>;
type Identity={subject:string;membership_level:string;bridged?:boolean;source_account_id?:string};
export type ShortScoutRenewal={identity:Identity|null;bridged:boolean;unavailable?:boolean;invalid?:boolean};
type Options={verify?:typeof verifyCurrentShortScoutAuthorization;now?:()=>number;sleep?:(ms:number)=>Promise<void>};

/** Only in-flight work is shared here. Current proof/cache/ordering live in SQL. */
export function createShortScoutRenewer({verify=verifyCurrentShortScoutAuthorization,now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}:Options={}){
 const pending=new Map<string,Promise<ShortScoutRenewal>>();
 return async function renew(admin:Admin,accountId:string,sessionHash:string|null=null):Promise<ShortScoutRenewal>{
  const key=`${accountId}:${sessionHash??'longboard'}`;
  const existing=pending.get(key);if(existing)return existing;
  const run=async():Promise<ShortScoutRenewal>=>{
   let bridged=false;const deadline=now()+6000;
   for(let attempt=0;attempt<8&&now()<deadline;attempt++){
    const next=await admin.rpc('begin_chat_shortscout_renewal',{p_account:accountId,p_session_hash:sessionHash}).abortSignal(AbortSignal.timeout(Math.max(1,deadline-now())));
    if(next.error||!next.data)return {identity:null,bridged,unavailable:true};
    const value=next.data;bridged=value.binding?.bridged===true;
    if(value.mode==='absent')return {identity:null,bridged:false};
    if(value.mode==='invalid')return {identity:null,bridged:false,invalid:true};
    if(value.mode==='unavailable')return {identity:null,bridged,unavailable:true};
    if(value.mode==='ready')return {identity:value.decision==='allow'?{...value.binding,membership_level:value.level}:null,bridged};
    if(value.mode==='pending'){
     await sleep(Math.max(0,Math.min(250*2**attempt,1500,deadline-now())));continue;
    }
    if(value.mode!=='refresh'||typeof value.subject!=='string'||!Number.isSafeInteger(value.generation)||deadline-now()<5000)return {identity:null,bridged,unavailable:true};
    const proof=await verify(value.subject);
    if(now()>=deadline)return {identity:null,bridged,unavailable:true};
    const applied=await admin.rpc('finish_chat_shortscout_renewal',{p_account:accountId,p_session_hash:sessionHash,p_subject:value.subject,p_generation:value.generation,p_state:proof.state,p_level:proof.level}).abortSignal(AbortSignal.timeout(Math.max(1,deadline-now())));
    if(applied.error)return {identity:null,bridged,unavailable:true};
    // Re-read the principal/binding and DB decision even after a successful CAS.
   }
   return {identity:null,bridged,unavailable:true};
  };
  if(pending.size>=5000)return {identity:null,bridged:false,unavailable:true};
  const task=run().catch(()=>({identity:null,bridged:false,unavailable:true} as ShortScoutRenewal)).finally(()=>{if(pending.get(key)===task)pending.delete(key);});
  pending.set(key,task);return task;
 };
}
export const renewChatShortScout=createShortScoutRenewer();
