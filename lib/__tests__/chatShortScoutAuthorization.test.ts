import {createHash,createHmac} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {createShortScoutAuthorizationVerifier} from '../chatShortScoutAuthorization';
const subject='10000000-0000-4000-8000-000000000001',secret='synthetic-local-key-for-authorization-tests';
const time=1790874000000;
const sign=(value:string)=>createHmac('sha256',secret).update(value).digest('hex');
function transport(mutate:(value:Record<string,unknown>)=>void=()=>{},responseMutate:(r:Response)=>void=()=>{}){
 return vi.fn(async(_url:unknown,init?:RequestInit)=>{
  const headers=new Headers(init?.headers),nonce=headers.get('x-chat-membership-nonce')!,stamp=headers.get('x-chat-membership-timestamp')!,body=String(init?.body);
  expect(headers.get('x-chat-membership-signature')).toBe(sign(`request\n${stamp}\n${nonce}\n${body}`));
  expect(JSON.parse(body)).toEqual({version:2,purpose:'chat-authorization',subjects:[subject]});
  const value:Record<string,unknown>={version:2,purpose:'chat-authorization',nonce,requestDigest:createHash('sha256').update(body).digest('hex'),records:[{subject,state:'allow',level:'mastermind'}]};
  mutate(value);const raw=JSON.stringify(value);
  const response=new Response(raw,{headers:{'x-chat-membership-timestamp':stamp,'x-chat-membership-signature':sign(`response\n${stamp}\n${nonce}\n${raw}`)}});responseMutate(response);return response;
 }) as unknown as typeof fetch;
}
it.each(['monthly','annual','lifetime','mastermind'])('accepts only signed exact current %s records',async level=>{
 const request=transport(v=>{v.records=[{subject,state:'allow',level}];});
 expect(await createShortScoutAuthorizationVerifier({key:()=>secret,request,now:()=>time})(subject)).toEqual({state:'allow',level});
 expect(request).toHaveBeenCalledWith('https://xejuximbbpnzqylukrsn.supabase.co/functions/v1/chat-membership-export',expect.objectContaining({cache:'no-store',redirect:'error',signal:expect.any(AbortSignal)}));
});
it('distinguishes authenticated denial from missing authority',async()=>{
 const request=transport(v=>{v.records=[{subject,state:'deny',level:null}];});
 expect(await createShortScoutAuthorizationVerifier({key:()=>secret,request,now:()=>time})(subject)).toEqual({state:'deny',level:null});
});
it.each([
 ['badge v1',(v:Record<string,unknown>)=>{v.version=1;delete v.purpose;v.records=[{subject,level:'mastermind'}];}],
 ['wrong purpose',(v:Record<string,unknown>)=>{v.purpose='badge';}],
 ['wrong nonce',(v:Record<string,unknown>)=>{v.nonce='0'.repeat(32);}],
 ['wrong request',(v:Record<string,unknown>)=>{v.requestDigest='0'.repeat(64);}],
 ['extra record',(v:Record<string,unknown>)=>{(v.records as unknown[]).push({subject,state:'deny',level:null});}],
 ['missing record',(v:Record<string,unknown>)=>{v.records=[];}],
 ['wrong subject',(v:Record<string,unknown>)=>{v.records=[{subject:'10000000-0000-4000-8000-000000000002',state:'allow',level:'mastermind'}];}],
 ['unknown tier',(v:Record<string,unknown>)=>{v.records=[{subject,state:'allow',level:'Mastermind'}];}],
 ['paid deny',(v:Record<string,unknown>)=>{v.records=[{subject,state:'deny',level:'mastermind'}];}],
 ['extra field',(v:Record<string,unknown>)=>{v.extra=true;}],
])('fails closed for %s',async(_label,mutate)=>{
 expect(await createShortScoutAuthorizationVerifier({key:()=>secret,request:transport(mutate),now:()=>time})(subject)).toEqual({state:'unavailable',level:null});
});
it.each(['signature','timestamp','status','body','elapsed','rotation'])('fails closed for %s transport failure',async kind=>{
 let current=time,key=secret;
 const base=transport(()=>{},response=>{if(kind==='signature')response.headers.set('x-chat-membership-signature','0'.repeat(64));if(kind==='timestamp')response.headers.set('x-chat-membership-timestamp','1000000000');});
 const request=async(...args:Parameters<typeof fetch>)=>{const result=await base(...args);if(kind==='elapsed')current+=5000;if(kind==='rotation')key+='changed';if(kind==='status')return new Response(null,{status:503});if(kind==='body')return new Response('x'.repeat(65537));return result;};
 expect(await createShortScoutAuthorizationVerifier({key:()=>key,request,now:()=>current})(subject)).toEqual({state:'unavailable',level:null});
});
it('does not call an endpoint without a key or with a caller-controlled subject',async()=>{
 const request=vi.fn();expect(await createShortScoutAuthorizationVerifier({key:()=>undefined,request})(subject)).toEqual({state:'unavailable',level:null});
 await createShortScoutAuthorizationVerifier({key:()=>secret,request})('https://attacker.invalid');expect(request).not.toHaveBeenCalled();
});
