import {expect,it,vi} from 'vitest';
import {syncShortScoutMembership} from '../chatShortScoutSync';
type Admin=Parameters<typeof syncShortScoutMembership>[0];
const s=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fakeAdmin(subjects:string[],opts:{finish?:(args:Record<string,unknown>)=>unknown}={}){
 const calls:Array<[string,Record<string,unknown>|undefined]>=[];let generation=0;
 const rpc=vi.fn(async(name:string,args?:Record<string,unknown>)=>{calls.push([name,args]);
  if(name==='chat_shortscout_sync_subjects')return {data:subjects};
  if(name==='begin_chat_shortscout_sync')return {data:{mode:'refresh',subject:args!.p_subject,generation:++generation}};
  if(name==='finish_chat_shortscout_sync')return opts.finish?opts.finish(args!):{data:true};
  return {error:{message:'unexpected'}};});
 return {admin:{rpc} as unknown as Admin,calls};
}
it('checks every subject once through reserve and apply, in one run',async()=>{
 const {admin,calls}=fakeAdmin([s(1),s(2),s(3)]);
 const verify=vi.fn(async(subject:string)=>subject===s(2)?{state:'deny' as const,level:null}:{state:'allow' as const,level:'mastermind'});
 expect(await syncShortScoutMembership(admin,{verify})).toEqual({subjects:3,allow:2,deny:1,unavailable:0,superseded:0});
 expect(verify).toHaveBeenCalledTimes(3);
 const finishes=calls.filter(c=>c[0]==='finish_chat_shortscout_sync').map(c=>c[1]!);
 expect(new Set(finishes.map(f=>f.p_run)).size).toBe(1);
 expect(finishes.find(f=>f.p_subject===s(2))).toMatchObject({p_state:'deny',p_level:null});
 for(const f of finishes)expect(typeof f.p_generation).toBe('number');
});
it('counts outages and overtaken answers without failing the run',async()=>{
 const {admin}=fakeAdmin([s(1),s(2),s(3)],{finish:args=>({data:args.p_subject!==s(3)})});
 const verify=vi.fn(async(subject:string)=>subject===s(1)?{state:'unavailable' as const,level:null}:{state:'allow' as const,level:'annual'});
 expect(await syncShortScoutMembership(admin,{verify})).toEqual({subjects:3,allow:1,deny:0,unavailable:1,superseded:1});
});
it('limits how many ShortScout checks run at once',async()=>{
 const {admin}=fakeAdmin(Array.from({length:20},(_,i)=>s(i+1)));let live=0,peak=0;
 const verify=vi.fn(async()=>{live++;peak=Math.max(peak,live);await new Promise(r=>setTimeout(r,5));live--;return {state:'allow' as const,level:'monthly'};});
 expect((await syncShortScoutMembership(admin,{verify,concurrency:4})).allow).toBe(20);expect(peak).toBe(4);
});
it('fails loudly when the subject list cannot be read',async()=>{
 const admin={rpc:vi.fn(async()=>({error:{message:'down'}}))} as unknown as Admin;
 await expect(syncShortScoutMembership(admin,{verify:vi.fn()})).rejects.toThrow('shortscout_sync_subjects_failed');
});
