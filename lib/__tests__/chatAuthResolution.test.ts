import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({user:vi.fn(),rpc:vi.fn(),from:vi.fn(),cookie:vi.fn(),upsert:vi.fn(),rows:{} as Record<string,unknown>,errors:new Set<string>(),calls:[] as string[]}));
vi.mock('@/lib/auth',()=>({getCurrentUser:m.user}));
vi.mock('@/lib/chatAdmin',()=>({createChatAdminClient:()=>({from:m.from,rpc:m.rpc})}));
vi.mock('next/headers',()=>({cookies:async()=>({get:m.cookie})}));
import {allowedChatRooms} from '@/lib/chatAccess';
import {requireChatUser} from '@/lib/chatAuth';
const id='00000000-0000-4000-8000-000000000001';
beforeEach(()=>{
 vi.clearAllMocks();m.calls=[];m.errors.clear();m.rows={chat_accounts:{id},chat_provider_identities:{subject:'ss',membership_level:'mastermind'},user_tags:[{tag:'boardroom-cohort-1'}],profiles:{id},chat_sessions:{account_id:id}};
 m.rpc.mockImplementation(()=>{m.calls.push('chat_provider_identities');return Promise.resolve({data:m.rows.chat_provider_identities??null,error:m.errors.has('chat_provider_identities')?{message:'failed'}:null});});
 m.user.mockResolvedValue({ok:true,user:{id,email:'test@example.test',role:'user'}});m.cookie.mockReturnValue({value:'s'.repeat(43)});m.upsert.mockResolvedValue({error:null});
 m.from.mockImplementation((table:string)=>{
  const q:Record<string,unknown>={};
  for(const method of ['select','eq','gt','is','in','limit'])q[method]=()=>q;
  const read=()=>{m.calls.push(table);return Promise.resolve({data:m.rows[table]??null,error:m.errors.has(table)?{message:'failed'}:null});};
  q.maybeSingle=read;q.then=(resolve:unknown,reject:unknown)=>read().then(resolve as never,reject as never);q.upsert=m.upsert;return q;
 });
});
afterEach(()=>vi.useRealTimers());
it('reads fresh permissions without writing existing accounts',async()=>{
 expect(await requireChatUser()).toMatchObject({ok:true,serverSession:false,access:{boardroom:true,shortscout:true}});
 expect(m.user).toHaveBeenCalledTimes(1);expect(m.upsert).not.toHaveBeenCalled();
 m.rows.user_tags=[];m.rows.chat_provider_identities=null;
 expect(await requireChatUser()).toMatchObject({ok:true,access:{boardroom:false,shortscout:false}});expect(m.user).toHaveBeenCalledTimes(2);
});
it('provisions only a missing verified account and preserves concurrent links',async()=>{
 m.rows.chat_accounts=null;expect((await requireChatUser()).ok).toBe(true);
 expect(m.upsert).toHaveBeenCalledWith({id,longboard_user_id:id},{onConflict:'id',ignoreDuplicates:true});
 m.upsert.mockResolvedValue({error:{message:'failed'}});expect(await requireChatUser()).toMatchObject({ok:false,status:503});
});
it.each(['chat_accounts','chat_provider_identities','user_tags'])('fails closed when %s lookup fails',async table=>{
 m.errors.add(table);expect(await requireChatUser()).toMatchObject({ok:false,status:503});expect(m.upsert).not.toHaveBeenCalled();
});
it('starts all independent reads without waiting for the first result',async()=>{
 let release!:()=>void;const pending=new Promise<void>(r=>release=r);
 m.from.mockImplementation((table:string)=>{
  const q:Record<string,unknown>={};for(const method of ['select','eq','gt','in','limit'])q[method]=()=>q;
  const read=()=>{m.calls.push(table);return pending.then(()=>({data:m.rows[table],error:null}));};q.maybeSingle=read;q.then=(a:never,b:never)=>read().then(a,b);return q;
 });
 const result=requireChatUser();await new Promise(r=>setTimeout(r,0));expect(m.calls.sort()).toEqual(['chat_accounts','chat_provider_identities','user_tags']);release();expect((await result).ok).toBe(true);
});
it('rejects expired/revoked cookie sessions before reading any account',async()=>{
 m.user.mockResolvedValue({ok:false,status:401});m.rows.chat_sessions=null;
 expect(await requireChatUser()).toMatchObject({ok:false,status:401});expect(m.calls).toEqual(['chat_sessions']);
});
it('cookie identities never inherit admin role and lose stale provider access',async()=>{
 m.user.mockResolvedValue({ok:false,status:401});m.rows.chat_accounts={id,longboard_user_id:id};
 expect(await requireChatUser()).toMatchObject({ok:true,serverSession:true,user:{role:'user'},access:{admin:false,boardroom:true}});
 m.rows.profiles=null;expect(await requireChatUser()).toMatchObject({ok:true,access:{longboard:false,boardroom:false}});
 m.rows.chat_provider_identities=null;expect(await requireChatUser()).toMatchObject({ok:false,status:401});
});
it('does not reuse a previous account after logout or account change',async()=>{
 await requireChatUser();m.user.mockResolvedValue({ok:false,status:401});m.cookie.mockReturnValue(undefined);
 expect(await requireChatUser()).toMatchObject({ok:false,status:401});
 m.user.mockResolvedValue({ok:true,user:{id:'other',email:'other@example.test',role:'user'}});
 expect(await requireChatUser()).toMatchObject({ok:true,user:{id:'other'}});
});

it.each(['monthly','annual','lifetime'])('immediately rejects cached %s for SS while preserving paid Social on linked and cookie sessions',async level=>{
 m.rows.chat_provider_identities={subject:'ss',membership_level:level};
 expect(await requireChatUser()).toMatchObject({ok:true,access:{shortscout:false,shortscoutMember:true,longboard:true}});
 m.user.mockResolvedValue({ok:false,status:401});m.rows.chat_accounts={id,longboard_user_id:null};
 expect(await requireChatUser()).toMatchObject({ok:true,serverSession:true,access:{shortscout:false,shortscoutMember:true,longboard:false}});
});
it('reads tier changes on every request and never treats admin as a mastermind',async()=>{
 m.user.mockResolvedValue({ok:true,user:{id,email:'test@example.test',role:'admin'}});
 expect(await requireChatUser()).toMatchObject({ok:true,access:{shortscout:true}});
 m.rows.chat_provider_identities={subject:'ss',membership_level:'annual'};
 expect(await requireChatUser()).toMatchObject({ok:true,access:{shortscout:false,admin:true}});
});
it.each(['free','Mastermind','unknown',undefined])('fails closed for malformed cookie identity tier %s',async level=>{m.user.mockResolvedValue({ok:false,status:401});m.rows.chat_provider_identities={subject:'ss',membership_level:level};expect(await requireChatUser()).toMatchObject({ok:false,status:401});});

it('Longboard admin needs no provider identity and loses exception immediately on role revocation',async()=>{
 m.rows.chat_provider_identities=null;m.rows.user_tags=[];
 m.user.mockResolvedValue({ok:true,user:{id,email:'admin@example.test',role:'admin'}});
 let auth=await requireChatUser();expect(auth).toMatchObject({ok:true,access:{longboard:true,admin:true,shortscout:false}});
 if(auth.ok)expect(allowedChatRooms(auth.access)).toHaveLength(8);
 m.user.mockResolvedValue({ok:true,user:{id,email:'admin@example.test',role:'user'}});
 auth=await requireChatUser();if(auth.ok)expect(allowedChatRooms(auth.access)).toEqual(['social','gainers']);
});
it('linked cookie derives only public-room exception from live profile and keeps private admin role unavailable',async()=>{
 m.user.mockResolvedValue({ok:false,status:401});m.rows.chat_accounts={id,longboard_user_id:id};m.rows.user_tags=[];
 m.rows.chat_provider_identities={subject:'ss',membership_level:'annual'};m.rows.profiles={id,role:'admin'};
 let auth=await requireChatUser();expect(auth).toMatchObject({ok:true,user:{role:'user'},access:{admin:true}});
 if(auth.ok)expect(allowedChatRooms(auth.access)).toHaveLength(8);
 m.rows.profiles={id,role:'user'};auth=await requireChatUser();if(auth.ok)expect(allowedChatRooms(auth.access)).toEqual(['social','gainers']);
 m.rows.profiles={id,role:'admin'};m.rows.chat_provider_identities=null;expect(await requireChatUser()).toMatchObject({ok:false,status:401});
});
it('linked profile lookup failure cannot grant admin rooms',async()=>{
 m.user.mockResolvedValue({ok:false,status:401});m.rows.chat_accounts={id,longboard_user_id:id};m.errors.add('profiles');
 expect(await requireChatUser()).toMatchObject({ok:false,status:503});
});

it('uses the protected resolver for bridged LB and cookie identities without changing the actor',async()=>{
 m.rows.chat_provider_identities={subject:'ss-original',membership_level:'mastermind',bridged:true,source_account_id:'original'};
 expect(await requireChatUser()).toMatchObject({ok:true,user:{id},hasSeparateShortScoutProfile:true,access:{shortscout:true}});
 expect(m.rpc).toHaveBeenCalledWith('chat_shortscout_identity',{p_account:id});
 m.user.mockResolvedValue({ok:false,status:401});m.rows.chat_accounts={id,longboard_user_id:id};
 expect(await requireChatUser()).toMatchObject({ok:true,user:{id,role:'user'},serverSession:true,hasSeparateShortScoutProfile:true});
 m.rows.chat_provider_identities=null;expect(await requireChatUser()).toMatchObject({ok:false,status:401});
});
