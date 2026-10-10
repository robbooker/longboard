import {beforeEach,it,expect,vi} from 'vitest';
// A small model of the two request-context functions over the rows each test sets.
const m=vi.hoisted(()=>({claims:vi.fn(),rpc:vi.fn(),cookie:vi.fn(),rows:{} as Record<string,unknown>,errors:new Set<string>(),calls:[] as string[]}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getClaims:m.claims}})}));
vi.mock('@/lib/chatAdmin',()=>({createChatAdminClient:()=>({rpc:(...args:unknown[])=>{const result=m.rpc(...args);return Object.assign(result,{abortSignal:()=>result});}})}));
vi.mock('next/headers',()=>({cookies:async()=>({get:m.cookie})}));
import {allowedChatRooms} from '@/lib/chatAccess';
import {requireChatUser} from '@/lib/chatAuth';
const id='00000000-0000-4000-8000-000000000001';
type Row={id:string;email?:string;role?:string;longboard_user_id?:string|null;account_id?:string};
const copy=()=>{const b=m.rows.identity as {membership_level:string}|null;return m.errors.has('copy')?{mode:'unavailable'}:b?{mode:'ready',decision:'allow',level:b.membership_level,binding:b}:{mode:'absent'};};
const signedIn=(user=id)=>m.claims.mockResolvedValue({data:{claims:{sub:user,session_id:'sess',email:`${user}@example.test`}},error:null});
beforeEach(()=>{
 vi.clearAllMocks();m.calls=[];m.errors.clear();
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
 if(auth.ok)expect(allowedChatRooms(auth.access)).toHaveLength(8);
 m.rows.profile={id,email:'admin@example.test',role:'user'};
 auth=await requireChatUser();if(auth.ok)expect(allowedChatRooms(auth.access)).toEqual(['social','gainers']);
});
it('linked cookie derives only public-room exception from live profile and keeps private admin role unavailable',async()=>{
 signedOut();m.rows.tags=false;m.rows.identity={subject:'ss',membership_level:'annual'};m.rows.profile={id,role:'admin'};
 let auth=await requireChatUser();expect(auth).toMatchObject({ok:true,user:{role:'user'},access:{admin:true}});
 if(auth.ok)expect(allowedChatRooms(auth.access)).toHaveLength(8);
 m.rows.profile={id,role:'user'};auth=await requireChatUser();if(auth.ok)expect(allowedChatRooms(auth.access)).toEqual(['social','gainers']);
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
