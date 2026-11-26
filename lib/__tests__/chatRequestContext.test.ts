import {expect,it,vi} from 'vitest';
import {createRequestContextReader,shortScoutFromCopy} from '../chatRequestContext';
type Admin=Parameters<ReturnType<typeof createRequestContextReader>['longboard']>[0];
const binding={subject:'10000000-0000-4000-8000-000000000001',bridged:true};
const ready={mode:'ready',decision:'allow',level:'mastermind',binding};
const user={id:'u',email:'u@example.test',role:'admin'};
const admin=(rpc:(...args:unknown[])=>Promise<unknown>)=>({rpc:(...args:unknown[])=>{const result=rpc(...args);return Object.assign(result,{abortSignal:()=>result});}}) as unknown as Admin;
it('reads a Longboard request in one call and, with the cache off, never keeps a completed result',async()=>{
 const rpc=vi.fn().mockResolvedValueOnce({data:{mode:'ok',user,boardroom:true,shortscout:ready}}).mockResolvedValueOnce({data:{mode:'unauthenticated'}});
 const read=createRequestContextReader();
 expect(await read.longboard(admin(rpc),'u','s')).toMatchObject({mode:'ok',user:{role:'admin'},boardroom:true,shortscout:{identity:{membership_level:'mastermind'},bridged:true}});
 expect(rpc).toHaveBeenCalledWith('chat_longboard_request_context',{p_user:'u',p_session:'s'});
 expect(await read.longboard(admin(rpc),'u','s')).toEqual({mode:'unauthenticated'});expect(rpc).toHaveBeenCalledTimes(2);
});
it('keeps a missing profile distinct and never trusts an unknown role',async()=>{
 const rpc=vi.fn().mockResolvedValueOnce({data:{mode:'no_profile'}}).mockResolvedValueOnce({data:{mode:'ok',user:{...user,role:'owner'},boardroom:false,shortscout:{mode:'absent'}}});
 const read=createRequestContextReader();
 expect(await read.longboard(admin(rpc),'u','s')).toEqual({mode:'no_profile'});
 expect(await read.longboard(admin(rpc),'u','s')).toMatchObject({user:{role:'user'},shortscout:{identity:null,bridged:false}});
});
it('reads a chat sign-in session in one call',async()=>{
 const rpc=vi.fn().mockResolvedValueOnce({data:{mode:'ok',account:'a',longboard:true,role:'admin',boardroom:true,shortscout:ready}}).mockResolvedValueOnce({data:{mode:'unauthenticated'}});
 const read=createRequestContextReader();
 expect(await read.session(admin(rpc),'hash')).toMatchObject({mode:'ok',account:'a',longboard:true,role:'admin',shortscout:{identity:{subject:binding.subject}}});
 expect(rpc).toHaveBeenCalledWith('chat_session_request_context',{p_token_hash:'hash'});
 expect(await read.session(admin(rpc),'hash')).toEqual({mode:'unauthenticated'});
});
it('coalesces simultaneous requests from the same principal only',async()=>{
 let release!:(value:unknown)=>void;const delayed=new Promise(r=>release=r);const rpc=vi.fn().mockReturnValueOnce(delayed).mockResolvedValue({data:{mode:'unauthenticated'}});
 const read=createRequestContextReader();const a=read.longboard(admin(rpc),'u','one'),b=read.longboard(admin(rpc),'u','one');await read.longboard(admin(rpc),'u','two');await read.session(admin(rpc),'one');
 expect(rpc).toHaveBeenCalledTimes(3);release({data:{mode:'ok',user,boardroom:false,shortscout:ready}});expect(await a).toBe(await b);
});
// #522: the live video token reads who is asking fresh, never from the 30-second memory.
it('a fresh read is never answered from the kept answer, for a Longboard sign-in and a chat sign-in',async()=>{
 const saved=process.env.CHAT_SESSION_CACHE;delete process.env.CHAT_SESSION_CACHE;
 try{
  const ok={data:{mode:'ok',user,boardroom:true,shortscout:ready}},gone={data:{mode:'unauthenticated'}};
  const rpc=vi.fn().mockResolvedValueOnce(ok).mockResolvedValueOnce(gone).mockResolvedValue(gone);
  const read=createRequestContextReader();
  expect(await read.longboard(admin(rpc),'u','s')).toMatchObject({mode:'ok'});
  // Kept: an ordinary request asks the database nothing more...
  expect(await read.longboard(admin(rpc),'u','s')).toMatchObject({mode:'ok'});expect(rpc).toHaveBeenCalledTimes(1);
  // ...but a fresh one does, and hears that the member was suspended a moment ago.
  expect(await read.longboard(admin(rpc),'u','s',true)).toEqual({mode:'unauthenticated'});expect(rpc).toHaveBeenCalledTimes(2);
  // And that fresh "no" clears what this server had kept: the next ordinary request is refused too.
  expect(await read.longboard(admin(rpc),'u','s')).toEqual({mode:'unauthenticated'});expect(rpc).toHaveBeenCalledTimes(3);
  const session={data:{mode:'ok',account:'a',longboard:true,role:'user',boardroom:true,shortscout:ready}};
  const rpc2=vi.fn().mockResolvedValueOnce(session).mockResolvedValue(gone);
  expect(await read.session(admin(rpc2),'hash')).toMatchObject({mode:'ok'});
  expect(await read.session(admin(rpc2),'hash')).toMatchObject({mode:'ok'});expect(rpc2).toHaveBeenCalledTimes(1);
  expect(await read.session(admin(rpc2),'hash',true)).toEqual({mode:'unauthenticated'});expect(rpc2).toHaveBeenCalledTimes(2);
 }finally{if(saved===undefined)delete process.env.CHAT_SESSION_CACHE;else process.env.CHAT_SESSION_CACHE=saved;}
});
it('reports a failed or timed-out read as unavailable, never as signed out',async()=>{
 const rpc=vi.fn().mockResolvedValueOnce({error:{message:'down'}}).mockRejectedValueOnce(new Error('timeout'));
 const read=createRequestContextReader();
 expect(await read.longboard(admin(rpc),'u','s')).toEqual({mode:'unavailable'});
 expect(await read.session(admin(rpc),'hash')).toEqual({mode:'unavailable'});
});
it('treats an overdue copy as unavailable and a known denial as no identity',()=>{
 expect(shortScoutFromCopy({mode:'unavailable',binding})).toEqual({identity:null,bridged:true,unavailable:true});
 expect(shortScoutFromCopy({mode:'ready',decision:'deny',binding})).toEqual({identity:null,bridged:true});
 expect(shortScoutFromCopy({mode:'invalid'})).toEqual({identity:null,bridged:false,invalid:true});
 expect(shortScoutFromCopy(null)).toMatchObject({unavailable:true});
});
