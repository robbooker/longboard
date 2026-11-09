import {beforeEach,describe,it,expect,vi} from 'vitest';
// A small model of the two request-context functions over the rows each test sets.
const m=vi.hoisted(()=>({claims:vi.fn(),rpc:vi.fn(),cookie:vi.fn(),authorization:null as string|null,rows:{} as Record<string,unknown>,errors:new Set<string>(),calls:[] as string[]}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getClaims:m.claims}})}));
vi.mock('@/lib/chatAdmin',()=>({createChatAdminClient:()=>({rpc:(...args:unknown[])=>{const result=m.rpc(...args);return Object.assign(result,{abortSignal:()=>result});}})}));
vi.mock('next/headers',()=>({cookies:async()=>({get:m.cookie}),headers:async()=>({get:(name:string)=>name==='authorization'?m.authorization:null})}));
import {allowedChatRooms} from '@/lib/chatAccess';
import {requireChatUser} from '@/lib/chatAuth';
import {isChatAdmin} from '@/lib/chatRole';
const id='00000000-0000-4000-8000-000000000001';
type Row={id:string;email?:string;role?:string;longboard_user_id?:string|null;account_id?:string};
const copy=()=>{const b=m.rows.identity as {membership_level:string}|null;return m.errors.has('copy')?{mode:'unavailable'}:b?{mode:'ready',decision:'allow',level:b.membership_level,binding:b}:{mode:'absent'};};
const signedIn=(user=id)=>m.claims.mockResolvedValue({data:{claims:{sub:user,session_id:'sess',email:`${user}@example.test`}},error:null});
beforeEach(()=>{
 vi.clearAllMocks();m.calls=[];m.errors.clear();m.authorization=null;
 m.rows={sessions:new Set(['sess']),profile:{id,email:'test@example.test',role:'user'},tags:true,identity:{subject:'ss',membership_level:'mastermind'},chat_session:{account_id:id},account:{id,longboard_user_id:id}};
 signedIn();m.cookie.mockReturnValue({value:'s'.repeat(43)});
 m.rpc.mockImplementation((fn:string,args:Record<string,string>)=>{
  m.calls.push(fn);if(m.errors.has(fn))return Promise.resolve({data:null,error:{message:'failed'}});
  if(fn==='chat_longboard_request_context'){
   if(!(m.rows.sessions as Set<string>).has(args.p_session))return Promise.resolve({data:{mode:'unauthenticated'},error:null});
   const profile=m.rows.profile as Row|null;if(!profile)return Promise.resolve({data:{mode:'no_profile'},error:null});
   return Promise.resolve({data:{mode:'ok',user:{...profile,id:args.p_user},boardroom:m.rows.tags,shortscout:copy()},error:null});
  }
  const account=(m.rows.chat_session?m.rows.account:null) as Row|null;if(!account)return Promise.resolve({data:{mode:'unauthenticated'},error:null});
  const profile=account.longboard_user_id?m.rows.profile as Row|null:null;
  return Promise.resolve({data:{mode:'ok',account:account.id,longboard:!!profile,role:profile?.role??null,boardroom:!!profile&&m.rows.tags,shortscout:copy()},error:null});
 });
});
const signedOut=()=>m.claims.mockResolvedValue({data:null,error:{message:'no session'}});
it('answers a Longboard request with one local token check and one database call',async()=>{
 expect(await requireChatUser()).toMatchObject({ok:true,serverSession:false,user:{id,email:'test@example.test'},access:{boardroom:true,shortscout:true}});
 expect(m.claims).toHaveBeenCalledTimes(1);expect(m.calls).toEqual(['chat_longboard_request_context']);
 expect(m.rpc).toHaveBeenCalledWith('chat_longboard_request_context',{p_user:id,p_session:'sess'});
 m.rows.tags=false;m.rows.identity=null;
 expect(await requireChatUser()).toMatchObject({ok:true,access:{boardroom:false,shortscout:false}});
});
it('a signed-out Longboard session ends chat access and falls through to a chat sign-in',async()=>{
 (m.rows.sessions as Set<string>).clear();
 expect(await requireChatUser()).toMatchObject({ok:true,serverSession:true,user:{role:'user'}});
 expect(m.calls).toEqual(['chat_longboard_request_context','chat_session_request_context']);
 m.cookie.mockReturnValue(undefined);expect(await requireChatUser()).toMatchObject({ok:false,status:401});
});
it('a token without a session id is never trusted',async()=>{
 m.claims.mockResolvedValue({data:{claims:{sub:id}},error:null});m.cookie.mockReturnValue(undefined);
 expect(await requireChatUser()).toMatchObject({ok:false,status:401});expect(m.calls).toEqual([]);
 m.claims.mockRejectedValue(new Error('jwks down'));expect(await requireChatUser()).toMatchObject({ok:false,status:401});
});
it.each(['chat_longboard_request_context','chat_session_request_context'])('fails closed when %s fails',async fn=>{
 if(fn==='chat_session_request_context')signedOut();
 m.errors.add(fn);expect(await requireChatUser()).toMatchObject({ok:false,status:503});
});
it('rejects expired/revoked cookie sessions',async()=>{
 signedOut();m.rows.chat_session=null;
 expect(await requireChatUser()).toMatchObject({ok:false,status:401});expect(m.calls).toEqual(['chat_session_request_context']);
});
it('cookie identities never inherit admin role and lose stale provider access',async()=>{
 signedOut();
 expect(await requireChatUser()).toMatchObject({ok:true,serverSession:true,user:{role:'user'},access:{admin:false,boardroom:true}});
 m.rows.profile=null;expect(await requireChatUser()).toMatchObject({ok:true,access:{longboard:false,boardroom:false}});
 m.rows.identity=null;expect(await requireChatUser()).toMatchObject({ok:false,status:401});
});
it('does not reuse a previous account after logout or account change',async()=>{
 await requireChatUser();signedOut();m.cookie.mockReturnValue(undefined);
 expect(await requireChatUser()).toMatchObject({ok:false,status:401});
 signedIn('other');expect(await requireChatUser()).toMatchObject({ok:true,user:{id:'other'}});
});
it.each(['monthly','annual','lifetime'])('immediately rejects cached %s for SS while preserving paid Social on linked and cookie sessions',async level=>{
 m.rows.identity={subject:'ss',membership_level:level};
 expect(await requireChatUser()).toMatchObject({ok:true,access:{shortscout:false,shortscoutMember:true,longboard:true}});
 signedOut();m.rows.account={id,longboard_user_id:null};
 expect(await requireChatUser()).toMatchObject({ok:true,serverSession:true,access:{shortscout:false,shortscoutMember:true,longboard:false}});
});
it('reads tier changes on every request and never treats admin as a mastermind',async()=>{
 m.rows.profile={id,email:'a@example.test',role:'admin'};
 expect(await requireChatUser()).toMatchObject({ok:true,access:{shortscout:true}});
 m.rows.identity={subject:'ss',membership_level:'annual'};
 expect(await requireChatUser()).toMatchObject({ok:true,access:{shortscout:false,admin:true}});
});
it.each(['free','Mastermind','unknown',undefined])('fails closed for malformed cookie identity tier %s',async level=>{signedOut();m.rows.identity={subject:'ss',membership_level:level};expect(await requireChatUser()).toMatchObject({ok:false,status:401});});
it('Longboard admin needs no provider identity and loses exception immediately on role revocation',async()=>{
 m.rows.identity=null;m.rows.tags=false;m.rows.profile={id,email:'admin@example.test',role:'admin'};
 let auth=await requireChatUser();expect(auth).toMatchObject({ok:true,access:{longboard:true,admin:true,shortscout:false}});
 if(auth.ok)expect(allowedChatRooms(auth.access)).toHaveLength(14);
 m.rows.profile={id,email:'admin@example.test',role:'user'};
 auth=await requireChatUser();if(auth.ok)expect(allowedChatRooms(auth.access)).toEqual(['social','gainers','whats-new','developers','lb-review','runner-watch','club']);
});
it('linked cookie derives admin from the live linked profile, the same as a Longboard sign-in (#354)',async()=>{
 signedOut();m.rows.tags=false;m.rows.identity={subject:'ss',membership_level:'annual'};m.rows.profile={id,role:'admin'};
 let auth=await requireChatUser();expect(auth).toMatchObject({ok:true,user:{role:'admin'},access:{admin:true}});
 if(auth.ok)expect(allowedChatRooms(auth.access)).toHaveLength(14);
 m.rows.profile={id,role:'user'};auth=await requireChatUser();if(auth.ok)expect(allowedChatRooms(auth.access)).toEqual(['social','gainers','whats-new','developers','lb-review','runner-watch','club']);
 m.rows.profile={id,role:'admin'};m.rows.identity=null;expect(await requireChatUser()).toMatchObject({ok:false,status:401});
});
it('bridged LB and cookie identities keep the actor',async()=>{
 m.rows.identity={subject:'ss-original',membership_level:'mastermind',bridged:true,source_account_id:'original'};
 expect(await requireChatUser()).toMatchObject({ok:true,user:{id},hasSeparateShortScoutProfile:true,access:{shortscout:true}});
 signedOut();expect(await requireChatUser()).toMatchObject({ok:true,user:{id,role:'user'},serverSession:true,hasSeparateShortScoutProfile:true});
 m.rows.identity=null;expect(await requireChatUser()).toMatchObject({ok:false,status:401});
});
it('an overdue copy locks SS without removing independently verified Longboard access',async()=>{
 m.errors.add('copy');expect(await requireChatUser()).toMatchObject({ok:true,access:{longboard:true,shortscout:false}});
 signedOut();expect(await requireChatUser()).toMatchObject({ok:false,status:503});
});
// #354: the same account gets the same access on longboardai.com/chat and chat.robbooker.com.
describe('chat sign-in session role (#354)',()=>{
 it('an admin on the chat sign-in session path gets admin, matching the Longboard sign-in',async()=>{
  m.rows.profile={id,email:'admin@example.test',role:'admin'};
  const longboard=await requireChatUser();
  signedOut();const session=await requireChatUser();
  expect(longboard).toMatchObject({ok:true,serverSession:false,user:{role:'admin'},access:{admin:true}});
  expect(session).toMatchObject({ok:true,serverSession:true,user:{id,role:'admin'},access:{admin:true}});
  expect(isChatAdmin(longboard)).toBe(true);expect(isChatAdmin(session)).toBe(true);
  if(longboard.ok&&session.ok)expect(allowedChatRooms(session.access)).toEqual(allowedChatRooms(longboard.access));
 });
 it('a non-admin on the chat sign-in session path gets no admin, matching the Longboard sign-in',async()=>{
  const longboard=await requireChatUser();
  signedOut();const session=await requireChatUser();
  expect(session).toMatchObject({ok:true,serverSession:true,user:{role:'user'},access:{admin:false}});
  expect(isChatAdmin(longboard)).toBe(false);expect(isChatAdmin(session)).toBe(false);
  if(longboard.ok&&session.ok)expect(allowedChatRooms(session.access)).toEqual(allowedChatRooms(longboard.access));
 });
 it('a role change on the linked profile shows on the next request, both ways',async()=>{
  signedOut();
  expect(isChatAdmin(await requireChatUser())).toBe(false);
  m.rows.profile={id,role:'admin'};expect(isChatAdmin(await requireChatUser())).toBe(true);
  m.rows.profile={id,role:'user'};
  const demoted=await requireChatUser();
  expect(demoted).toMatchObject({ok:true,user:{role:'user'},access:{admin:false}});expect(isChatAdmin(demoted)).toBe(false);
 });
 it('a session with no Longboard link never gets admin',async()=>{
  signedOut();m.rows.profile={id,role:'admin'};m.rows.account={id:'ss-only',longboard_user_id:null};
  const unlinked=await requireChatUser();
  expect(unlinked).toMatchObject({ok:true,serverSession:true,user:{id:'ss-only',role:'user'},access:{admin:false,longboard:false}});
  expect(isChatAdmin(unlinked)).toBe(false);
 });
 it('only exactly "admin" counts, and only with a linked profile',async()=>{
  signedOut();
  for(const role of ['Admin','owner','admin ',null]){m.rows.profile={id,role:role as string};expect(isChatAdmin(await requireChatUser())).toBe(false);}
  m.rpc.mockImplementationOnce(()=>Promise.resolve({data:{mode:'ok',account:id,longboard:false,role:'admin',boardroom:false,shortscout:copy()},error:null}));
  expect(await requireChatUser()).toMatchObject({ok:true,user:{role:'user'},access:{admin:false}});
 });
 it('isChatAdmin needs both the role and the admin entitlement',()=>{
  const base={ok:true as const,user:{role:'admin' as const},access:{admin:false}};
  expect(isChatAdmin(base)).toBe(false);
  expect(isChatAdmin({...base,user:{role:'user'},access:{admin:true}})).toBe(false);
  expect(isChatAdmin({...base,access:{admin:true}})).toBe(true);
  expect(isChatAdmin({ok:false})).toBe(false);
 });
});
