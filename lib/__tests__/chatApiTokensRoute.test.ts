import {beforeEach,it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
// CHAT-API: the token management route. Only a hash reaches the database; the token is returned once.
const mock=vi.hoisted(()=>({auth:vi.fn(),origin:vi.fn(),rpc:vi.fn()}));
vi.mock('@/lib/chatAuth',()=>({requireChatUser:mock.auth}));
vi.mock('@/lib/chatAdmin',()=>({requestOriginAllowed:mock.origin,createChatAdminClient:()=>({rpc:mock.rpc})}));
import {GET,POST,DELETE} from '@/app/api/chat/api-tokens/route';
import {chatSecretHash} from '@/lib/chatLoginProof';
const actor='00000000-0000-4000-8000-000000000001';
const tokenId='00000000-0000-4000-8000-0000000000aa';
const req=(method:string,body?:unknown)=>new NextRequest('https://chat.robbooker.com/api/chat/api-tokens',{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
beforeEach(()=>{vi.clearAllMocks();mock.origin.mockReturnValue(true);mock.auth.mockResolvedValue({ok:true,user:{id:actor}});});

it('lists the signed-in account\'s tokens and access',async()=>{
 mock.rpc.mockResolvedValue({data:{access:true,tokens:[]},error:null});
 const r=await GET(req('GET'));expect(r.status).toBe(200);expect(await r.json()).toEqual({access:true,tokens:[]});
 expect(mock.rpc).toHaveBeenCalledWith('list_chat_api_tokens',{actor});
});
it('passes on a failed sign-in, including a token trying to reach this route',async()=>{
 mock.auth.mockResolvedValue({ok:false,status:403,error:'not_available_with_api_token'});
 for(const r of [await GET(req('GET')),await POST(req('POST',{label:'x'})),await DELETE(req('DELETE',{id:tokenId}))])expect(r.status).toBe(403);
 expect(mock.rpc).not.toHaveBeenCalled();
});
it('creates a token, stores only its hash and hint, and returns it once',async()=>{
 mock.rpc.mockResolvedValue({data:{status:'created',token:{id:tokenId,label:'Bot',hint:'abcd'}},error:null});
 const r=await POST(req('POST',{label:'  Bot  '}));expect(r.status).toBe(200);
 const body=await r.json();expect(body.token).toMatch(/^lbc_[A-Za-z0-9_-]{43}$/);expect(body.details.id).toBe(tokenId);
 const [fn,args]=mock.rpc.mock.calls[0];expect(fn).toBe('create_chat_api_token');
 expect(args).toEqual({actor,p_label:'Bot',p_hash:chatSecretHash(body.token),p_hint:body.token.slice(-4)});
 expect(JSON.stringify(args)).not.toContain(body.token);
});
it('explains invite-only access and the 5-token limit',async()=>{
 mock.rpc.mockResolvedValueOnce({data:{status:'no_access'},error:null});
 let r=await POST(req('POST',{label:'Bot'}));expect(r.status).toBe(403);expect((await r.json()).error).toMatch(/invite-only/);
 mock.rpc.mockResolvedValueOnce({data:{status:'limit'},error:null});
 r=await POST(req('POST',{label:'Bot'}));expect(r.status).toBe(409);expect((await r.json()).error).toMatch(/5 active tokens/);
});
it.each([[{}],[{label:''}],[{label:'   '}],[{label:'x'.repeat(61)}],[{label:7}]])('rejects a bad name %j before the database',async body=>{
 expect((await POST(req('POST',body))).status).toBe(400);expect(mock.rpc).not.toHaveBeenCalled();
});
it('blocks other sites before signing in',async()=>{
 mock.origin.mockReturnValue(false);
 expect((await POST(req('POST',{label:'x'}))).status).toBe(403);expect((await DELETE(req('DELETE',{id:tokenId}))).status).toBe(403);
 expect(mock.auth).not.toHaveBeenCalled();
});
it('revokes only by a valid id and reports a token that isn\'t yours',async()=>{
 expect((await DELETE(req('DELETE',{id:'nope'}))).status).toBe(400);expect(mock.rpc).not.toHaveBeenCalled();
 mock.rpc.mockResolvedValueOnce({data:false,error:null});expect((await DELETE(req('DELETE',{id:tokenId}))).status).toBe(404);
 mock.rpc.mockResolvedValueOnce({data:true,error:null});expect((await DELETE(req('DELETE',{id:tokenId}))).status).toBe(200);
 expect(mock.rpc).toHaveBeenLastCalledWith('revoke_chat_api_token',{actor,p_id:tokenId});
});
it('reports the database being down',async()=>{
 mock.rpc.mockResolvedValue({data:null,error:{message:'down'}});
 expect((await GET(req('GET'))).status).toBe(503);expect((await POST(req('POST',{label:'x'}))).status).toBe(503);
});
