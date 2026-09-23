import {it,expect,vi} from 'vitest';
import {createHash,createHmac} from 'node:crypto';
import {createMembershipExportConsumer} from '../chatMembershipExport';
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002',secret='synthetic-test-key-never-a-production-secret';
const sign=(s:string)=>createHmac('sha256',secret).update(s).digest('hex');
function fixture(){
 let clock=1_800_000_000_000,level='mastermind',state='update';
 const request=vi.fn(async(_url:unknown,init?:RequestInit)=>{
  const headers=new Headers(init?.headers),body=init!.body as string,nonce=headers.get('x-chat-membership-nonce')!,stamp=headers.get('x-chat-membership-timestamp')!;
  expect(headers.get('x-chat-membership-signature')).toBe(sign(`request\n${stamp}\n${nonce}\n${body}`));expect(init?.redirect).toBe('error');expect(init?.cache).toBe('no-store');
  return response(init!,JSON.parse(body).subjects.map((subject:string)=>({subject,state,level:state==='delete'?null:level})),clock);
 });
 const read=createMembershipExportConsumer({key:()=>secret,request:request as typeof fetch,now:()=>clock});
 return {request,read,advance:(ms:number)=>clock+=ms,set:(s:string,l:string)=>{state=s;level=l;},now:()=>clock};
}
function response(init:RequestInit,records:unknown[],clock:number,patch:Record<string,unknown>={}){
 const nonce=new Headers(init.headers).get('x-chat-membership-nonce')!,timestamp=String(Math.floor(clock/1000));
 const body=JSON.stringify({version:1,nonce,requestDigest:createHash('sha256').update(init.body as string).digest('hex'),records,...patch});
 return new Response(body,{headers:{'x-chat-membership-timestamp':timestamp,'x-chat-membership-signature':sign(`response\n${timestamp}\n${nonce}\n${body}`)}});
}
it('uses current paid/free/deleted records independent of login, caches for60s and refreshes removals',async()=>{
 const f=fixture();expect(await f.read([a,a,b])).toEqual(new Set([a,b]));expect(f.request).toHaveBeenCalledTimes(1);
 f.set('revoke','free');f.advance(59999);expect(await f.read([a])).toEqual(new Set([a]));f.advance(1);expect(await f.read([a])).toEqual(new Set());
 f.set('update','annual');f.advance(60000);expect(await f.read([a])).toEqual(new Set([a]));f.set('delete','');f.advance(60000);expect(await f.read([a])).toEqual(new Set());
});
it('hides expired badges on failure, bounds retries, then recovers without login',async()=>{
 const f=fixture();await f.read([a]);f.advance(60000);f.request.mockRejectedValueOnce(Error('offline'));expect(await f.read([a])).toEqual(new Set());await f.read([a]);expect(f.request).toHaveBeenCalledTimes(2);f.advance(5000);expect(await f.read([a])).toEqual(new Set([a]));
});
it.each(['bad-signature','wrong-nonce','wrong-digest','missing','duplicate','extra','unknown-level','stale','oversize','redirect'])('fails closed for %s',async fault=>{
 const f=fixture();f.request.mockImplementationOnce(async(_url,init)=>{
  if(fault==='redirect')return new Response(null,{status:302});
  let rows:unknown[]=[{subject:a,state:'update',level:fault==='unknown-level'?'admin':'mastermind'}];
  if(fault==='missing')rows=[];if(fault==='duplicate')rows=[rows[0],rows[0]];if(fault==='extra')rows=[{subject:b,state:'update',level:'mastermind'}];
  const r=response(init!,rows,f.now()-(fault==='stale'?61000:0),fault==='wrong-nonce'?{nonce:'wrong'}:fault==='wrong-digest'?{requestDigest:'wrong'}:fault==='oversize'?{padding:'x'.repeat(66000)}:{});
  if(fault==='bad-signature')r.headers.set('x-chat-membership-signature','0'.repeat(64));return r;
 });expect(await f.read([a])).toEqual(new Set());
});
it('deduplicates overlapping requests and does not extend TTL for slow responses',async()=>{
 const f=fixture();let release!:()=>void;const gate=new Promise<void>(r=>release=r),original=f.request.getMockImplementation()!;
 f.request.mockImplementationOnce(async(...args)=>{await gate;return original(...args);});
 const first=f.read([a]),second=f.read([a]);expect(f.request).toHaveBeenCalledTimes(1);f.advance(59000);release();expect(await first).toEqual(new Set([a]));expect(await second).toEqual(new Set([a]));f.advance(1000);await f.read([a]);expect(f.request).toHaveBeenCalledTimes(2);
});
it('rejects a request that completes after its cache lifetime',async()=>{
 const f=fixture(),original=f.request.getMockImplementation()!;f.request.mockImplementationOnce(async(...args)=>{f.advance(61000);return original(...args);});expect(await f.read([a])).toEqual(new Set());
});
it('ignores invalid subjects, bounds batches, and does not call upstream without configured key',async()=>{
 const f=fixture();const ids=Array.from({length:201},(_,n)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`);expect((await f.read([...ids,'not-an-id'])).size).toBe(201);expect(f.request).toHaveBeenCalledTimes(2);
 const request=vi.fn();expect(await createMembershipExportConsumer({key:()=>undefined,request})([a])).toEqual(new Set());expect(request).not.toHaveBeenCalled();
});
it('key rotation clears paid cache and ignores an old in-flight response',async()=>{
 let key:string|undefined=secret;const f=fixture(),original=f.request.getMockImplementation()!;let release!:()=>void;
 f.request.mockImplementationOnce(async(...args)=>{await new Promise<void>(r=>release=r);return original(...args);});
 const read=createMembershipExportConsumer({key:()=>key,request:f.request as typeof fetch,now:f.now});
 const prior=read([a]);key=undefined;expect(await read([a])).toEqual(new Set());release();expect(await prior).toEqual(new Set());
 key=secret;expect(await read([a])).toEqual(new Set([a]));expect(f.request).toHaveBeenCalledTimes(2);
});
it('independent processes have independent bounded-lifetime caches',async()=>{
 const f=fixture();await f.read([a]);f.set('revoke','free');
 const other=createMembershipExportConsumer({key:()=>secret,request:f.request as typeof fetch,now:f.now});expect(await other([a])).toEqual(new Set());expect(await f.read([a])).toEqual(new Set([a]));f.advance(60000);expect(await f.read([a])).toEqual(new Set());
});
