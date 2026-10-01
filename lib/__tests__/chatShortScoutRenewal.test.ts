import {expect,it,vi} from 'vitest';
import {createShortScoutRenewer} from '../chatShortScoutRenewal';
type Admin=Parameters<ReturnType<typeof createShortScoutRenewer>>[0];
const binding={subject:'10000000-0000-4000-8000-000000000001',bridged:true};
const ready={mode:'ready',decision:'allow',level:'mastermind',binding};
const admin=(rpc:(...args:unknown[])=>Promise<unknown>)=>({rpc:(...args:unknown[])=>{const result=rpc(...args);return Object.assign(result,{abortSignal:()=>result});}}) as unknown as Admin;
it('uses the shared proof, rechecks after CAS, and never caches a completed result',async()=>{
 const verify=vi.fn().mockResolvedValue({state:'allow',level:'mastermind'});
 const rpc=vi.fn().mockResolvedValueOnce({data:{mode:'refresh',subject:binding.subject,generation:4,binding}}).mockResolvedValueOnce({data:true}).mockResolvedValueOnce({data:ready}).mockResolvedValueOnce({data:{mode:'invalid'}});
 const renew=createShortScoutRenewer({verify});expect(await renew(admin(rpc),'actor','hash')).toMatchObject({identity:{membership_level:'mastermind'},bridged:true});
 expect(rpc).toHaveBeenNthCalledWith(2,'finish_chat_shortscout_renewal',expect.objectContaining({p_account:'actor',p_session_hash:'hash',p_generation:4,p_subject:binding.subject}));
 expect(await renew(admin(rpc),'actor','hash')).toMatchObject({invalid:true,identity:null});expect(verify).toHaveBeenCalledTimes(1);
});
it('coalesces simultaneous same-process requests without sharing another principal',async()=>{
 let release!:(value:unknown)=>void;const delayed=new Promise(r=>release=r);const rpc=vi.fn().mockReturnValueOnce(delayed).mockResolvedValue({data:{mode:'absent'}});
 const renew=createShortScoutRenewer();const a=renew(admin(rpc),'actor','one'),b=renew(admin(rpc),'actor','one');await renew(admin(rpc),'actor','two');
 expect(rpc).toHaveBeenCalledTimes(2);release({data:ready});expect(await a).toEqual(await b);
});
it('backs off cross-instance pending work within a six-second total budget',async()=>{
 let time=0;const waits:number[]=[];const rpc=vi.fn().mockResolvedValue({data:{mode:'pending'}}),verify=vi.fn();
 const renew=createShortScoutRenewer({verify,now:()=>time,sleep:async ms=>{waits.push(ms);time+=ms;}});
 expect(await renew(admin(rpc),'actor')).toMatchObject({unavailable:true,identity:null});expect(time).toBe(6000);expect(rpc.mock.calls.length).toBeLessThanOrEqual(7);expect(waits.slice(0,4)).toEqual([250,500,1000,1500]);expect(verify).not.toHaveBeenCalled();
});
it('does not start another five-second source request after exhausting its deadline',async()=>{
 let time=0;const rpc=vi.fn().mockImplementation(async()=>{time+=2000;return {data:{mode:'refresh',subject:binding.subject,generation:1}};});const verify=vi.fn();
 expect(await createShortScoutRenewer({verify,now:()=>time})(admin(rpc),'actor')).toMatchObject({unavailable:true});expect(verify).not.toHaveBeenCalled();
});
it('rechecks a rejected finish and never returns its optimistic positive proof',async()=>{
 const rpc=vi.fn().mockResolvedValueOnce({data:{mode:'refresh',subject:binding.subject,generation:1}}).mockResolvedValueOnce({data:false}).mockResolvedValueOnce({data:{mode:'ready',decision:'deny',level:null,binding}});
 expect(await createShortScoutRenewer({verify:vi.fn().mockResolvedValue({state:'allow',level:'mastermind'})})(admin(rpc),'actor')).toMatchObject({identity:null});
});
