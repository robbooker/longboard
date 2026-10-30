import {beforeEach,it,expect,vi} from 'vitest';
// CHAT-API: a Bearer token signs in as its owner on the token routes only, and never falls back
// to the browser's sign-in.
const m=vi.hoisted(()=>({claims:vi.fn(),rpc:vi.fn(),cookie:vi.fn(),authorization:null as string|null}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getClaims:m.claims}})}));
vi.mock('@/lib/chatAdmin',()=>({createChatAdminClient:()=>({rpc:(...args:unknown[])=>{const result=m.rpc(...args);return Object.assign(result,{abortSignal:()=>result});}})}));
vi.mock('next/headers',()=>({cookies:async()=>({get:m.cookie}),headers:async()=>({get:(name:string)=>name==='authorization'?m.authorization:null})}));
import {requireChatUser} from '@/lib/chatAuth';
import {bearerChatApiToken,chatApiRouteAllowed,newChatApiToken} from '@/lib/chatApiToken';
import {chatSecretHash} from '@/lib/chatLoginProof';
import type {NextRequest} from 'next/server';
const id='00000000-0000-4000-8000-000000000001';
const token=`lbc_${'a'.repeat(43)}`;
const at=(path:string)=>({nextUrl:{pathname:path}}) as unknown as NextRequest;
const ok={mode:'ok',user:{id,email:'dev@example.test',role:'user'},boardroom:true,shortscout:{mode:'absent'}};
beforeEach(()=>{
 vi.clearAllMocks();m.authorization=`Bearer ${token}`;
 m.claims.mockResolvedValue({data:{claims:{sub:'someone-else',session_id:'sess'}},error:null});
 m.cookie.mockReturnValue({value:'s'.repeat(43)});
 m.rpc.mockResolvedValue({data:ok,error:null});
});

it('signs in as the token owner with one database call',async()=>{
 expect(await requireChatUser(at('/api/chat'))).toMatchObject({ok:true,apiToken:true,serverSession:false,user:{id,role:'user'},access:{longboard:true,boardroom:true,shortscout:false,admin:false}});
 expect(m.rpc).toHaveBeenCalledTimes(1);
 expect(m.rpc).toHaveBeenCalledWith('chat_api_request_context',{p_token_hash:chatSecretHash(token)});
 expect(m.claims).not.toHaveBeenCalled();
});
it('keeps the owner\'s admin role and ShortScout membership',async()=>{
 m.rpc.mockResolvedValue({data:{...ok,user:{...ok.user,role:'admin'},shortscout:{mode:'ready',decision:'allow',level:'mastermind',binding:{subject:'ss'}}},error:null});
 expect(await requireChatUser(at('/api/chat/history'))).toMatchObject({ok:true,access:{admin:true,shortscout:true}});
});
it('rejects an unknown, revoked or uninvited token without trying the browser sign-in',async()=>{
 m.rpc.mockResolvedValue({data:{mode:'unauthenticated'},error:null});
 expect(await requireChatUser(at('/api/chat'))).toEqual({ok:false,status:401,error:'invalid_token'});
 expect(m.claims).not.toHaveBeenCalled();expect(m.rpc).toHaveBeenCalledTimes(1);
});
it('rejects a malformed lbc_ token before the database',async()=>{
 m.authorization='Bearer lbc_short';
 expect(await requireChatUser(at('/api/chat'))).toEqual({ok:false,status:401,error:'invalid_token'});
 expect(m.rpc).not.toHaveBeenCalled();
});
it.each(['/api/chat/admin','/api/chat/push','/api/chat/push/test','/api/chat/api-tokens','/api/chat/summary','/api/chat/clarity','/api/chat/login/switch','/api/chat/timings'])('refuses %s with a token',async path=>{
 expect(await requireChatUser(at(path))).toEqual({ok:false,status:403,error:'not_available_with_api_token'});
 expect(m.rpc).not.toHaveBeenCalled();
});
it('refuses a token when the route does not pass its request',async()=>{
 expect(await requireChatUser()).toMatchObject({ok:false,status:403});
});
it('fails closed when the database is unavailable',async()=>{
 m.rpc.mockResolvedValue({data:null,error:{message:'down'}});
 expect(await requireChatUser(at('/api/chat'))).toMatchObject({ok:false,status:503});
});
it('an invalid ShortScout principal ends the token\'s access',async()=>{
 m.rpc.mockResolvedValue({data:{...ok,shortscout:{mode:'invalid'}},error:null});
 expect(await requireChatUser(at('/api/chat'))).toMatchObject({ok:false,status:401});
});
it('ignores other Authorization headers and uses the browser sign-in',async()=>{
 m.authorization='Bearer some-other-service-token';
 m.rpc.mockResolvedValue({data:{mode:'ok',user:{id,email:'x',role:'user'},boardroom:false,shortscout:{mode:'absent'}},error:null});
 const auth=await requireChatUser(at('/api/chat'));
 expect(auth).toMatchObject({ok:true});expect('apiToken' in auth&&auth.apiToken).toBeFalsy();
 expect(m.rpc.mock.calls[0][0]).toBe('chat_longboard_request_context');
});

it('parses Bearer headers strictly',()=>{
 expect(bearerChatApiToken(null)).toBeUndefined();
 expect(bearerChatApiToken('Basic abc')).toBeUndefined();
 expect(bearerChatApiToken('Bearer abc')).toBeUndefined();
 expect(bearerChatApiToken(`Bearer ${token}`)).toBe(token);
 expect(bearerChatApiToken(`bearer   ${token} `)).toBe(token);
 expect(bearerChatApiToken(`Bearer ${token}x`)).toBeNull();
 expect(bearerChatApiToken(`Bearer ${token} extra`)).toBeUndefined();
});
it('allows only the listed routes and attachment files',()=>{
 for(const p of ['/api/chat','/api/chat/','/api/chat/updates','/api/chat/attachments',`/api/chat/attachments/${id}`,`/api/chat/attachments/${id}/transcript`])expect(chatApiRouteAllowed(p)).toBe(true);
 for(const p of [undefined,'/api/chat/admin','/api/chat/attachments/x','/api/chat/updates/../admin','/api/chatx','/chat'])expect(chatApiRouteAllowed(p)).toBe(false);
});
it('makes unguessable tokens and stores only a hash and a 4-character hint',()=>{
 const a=newChatApiToken(),b=newChatApiToken();
 expect(a.token).toMatch(/^lbc_[A-Za-z0-9_-]{43}$/);expect(a.token).not.toBe(b.token);
 expect(a.hash).toBe(chatSecretHash(a.token));expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
 expect(a.hint).toBe(a.token.slice(-4));expect(bearerChatApiToken(`Bearer ${a.token}`)).toBe(a.token);
});
it('a bot token gets only its rooms: never admin, Boardroom or ShortScout, whatever the context says',async()=>{
 m.rpc.mockResolvedValue({data:{...ok,user:{...ok.user,role:'admin'},boardroom:true,shortscout:{mode:'ready',decision:'allow',level:'mastermind',binding:{subject:'ss'}},botRooms:['developers']},error:null});
 expect(await requireChatUser(at('/api/chat/history'))).toMatchObject({ok:true,apiToken:true,user:{id,role:'user'},access:{longboard:false,boardroom:false,shortscout:false,shortscoutMember:false,admin:false,botRooms:['developers']}});
 expect(m.rpc).toHaveBeenCalledTimes(1);
});
it('an ordinary token carries no room restriction',async()=>{
 const auth=await requireChatUser(at('/api/chat/history'));
 expect(auth.ok&&auth.access.botRooms).toBeUndefined();
});
