import {expect,it,vi} from 'vitest';
import {createShortScoutRenewer} from '../chatShortScoutRenewal';
type Admin=Parameters<ReturnType<typeof createShortScoutRenewer>>[0];
const binding={subject:'10000000-0000-4000-8000-000000000001',bridged:true};
const ready={mode:'ready',decision:'allow',level:'mastermind',binding};
const admin=(rpc:(...args:unknown[])=>Promise<unknown>)=>({rpc:(...args:unknown[])=>{const result=rpc(...args);return Object.assign(result,{abortSignal:()=>result});}}) as unknown as Admin;
it('reads the local copy with one call and never caches a completed result',async()=>{
 const rpc=vi.fn().mockResolvedValueOnce({data:ready}).mockResolvedValueOnce({data:{mode:'invalid'}});
 const renew=createShortScoutRenewer();expect(await renew(admin(rpc),'actor','hash')).toMatchObject({identity:{membership_level:'mastermind'},bridged:true});
 expect(rpc).toHaveBeenCalledWith('begin_chat_shortscout_renewal',{p_account:'actor',p_session_hash:'hash'});
 expect(await renew(admin(rpc),'actor','hash')).toMatchObject({invalid:true,identity:null});expect(rpc).toHaveBeenCalledTimes(2);
});
it('coalesces simultaneous same-process requests without sharing another principal',async()=>{
 let release!:(value:unknown)=>void;const delayed=new Promise(r=>release=r);const rpc=vi.fn().mockReturnValueOnce(delayed).mockResolvedValue({data:{mode:'absent'}});
 const renew=createShortScoutRenewer();const a=renew(admin(rpc),'actor','one'),b=renew(admin(rpc),'actor','one');await renew(admin(rpc),'actor','two');
 expect(rpc).toHaveBeenCalledTimes(2);release({data:ready});expect(await a).toEqual(await b);
});
it('treats an overdue copy as unavailable and a known denial as no identity',async()=>{
 const rpc=vi.fn().mockResolvedValueOnce({data:{mode:'unavailable',binding}}).mockResolvedValueOnce({data:{mode:'ready',decision:'deny',level:null,binding}});
 const renew=createShortScoutRenewer();
 expect(await renew(admin(rpc),'actor')).toEqual({identity:null,bridged:true,unavailable:true});
 expect(await renew(admin(rpc),'actor')).toEqual({identity:null,bridged:true});
});
it('reports a failed read as unavailable, never as a denial',async()=>{
 const rpc=vi.fn().mockResolvedValueOnce({error:{message:'down'}}).mockRejectedValueOnce(new Error('timeout'));
 const renew=createShortScoutRenewer();
 expect(await renew(admin(rpc),'actor')).toMatchObject({unavailable:true,identity:null});
 expect(await renew(admin(rpc),'actor')).toMatchObject({unavailable:true,identity:null});
});
