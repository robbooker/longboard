import {beforeEach,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const mock=vi.hoisted(()=>({auth:vi.fn(),origin:vi.fn(),rpc:vi.fn()}));
vi.mock('@/lib/chatAuth',()=>({requireChatUser:mock.auth}));
vi.mock('@/lib/chatAdmin',()=>({requestOriginAllowed:mock.origin,createChatAdminClient:()=>({rpc:mock.rpc})}));
import {POST} from '@/app/api/chat/member/route';
const account='00000000-0000-4000-8000-000000000001',member='00000000-0000-4000-8000-000000000002';
const request=(body:unknown)=>new NextRequest('https://longboard.test/api/chat/member',{method:'POST',body:JSON.stringify(body)});
beforeEach(()=>{vi.clearAllMocks();mock.origin.mockReturnValue(true);mock.auth.mockResolvedValue({ok:true,user:{id:account}});mock.rpc.mockResolvedValue({data:{id:member,display_name:'Alice Baker',accepts_requests:true,name_revision:1},error:null});});
it('renames only the verified actor and ignores forged ownership, privilege and token fields',async()=>{
 const result=await POST(request({action:'rename',displayName:' Alice   Baker ',accountId:'forged',memberId:'forged',admin:true,token:member}));
 expect(result.status).toBe(200);expect(mock.rpc).toHaveBeenCalledWith('chat_update_member_name',{p_account:account,p_name:'Alice Baker'});expect(await result.json()).toEqual({signedIn:true,accountId:account,member:{id:member,display_name:'Alice Baker',accepts_requests:true,name_revision:1}});
});
it('retains the legacy link action and guest hash rather than silently renaming existing users',async()=>{await POST(request({displayName:'Alice Baker',token:member}));expect(mock.rpc).toHaveBeenCalledWith('longboard_chat_link_member',expect.objectContaining({p_user_id:account,p_name:'Alice Baker',p_token_hash:expect.stringMatching(/^[a-f\d]{64}$/)}));});
it.each(["O'Neill",'O’Neill','O‘Neill'])('passes %s as data for both link and rename',async name=>{
 expect((await POST(request({displayName:name}))).status).toBe(200);expect(mock.rpc).toHaveBeenLastCalledWith('longboard_chat_link_member',{p_user_id:account,p_name:name,p_token_hash:null});
 expect((await POST(request({action:'rename',displayName:name,accountId:'forged'}))).status).toBe(200);expect(mock.rpc).toHaveBeenLastCalledWith('chat_update_member_name',{p_account:account,p_name:name});
});
it('rejects cross-origin, unauthenticated, malformed and inappropriate input before mutation',async()=>{
 mock.origin.mockReturnValue(false);expect((await POST(request({action:'rename',displayName:'Alice'}))).status).toBe(403);mock.origin.mockReturnValue(true);
 mock.auth.mockResolvedValue({ok:false,status:401,error:'unauthenticated'});expect((await POST(request({action:'rename',displayName:'Alice'}))).status).toBe(401);mock.auth.mockResolvedValue({ok:true,user:{id:account}});
 for(const body of [{action:'delete',displayName:'Alice'},{action:'rename',displayName:''},{action:'rename',displayName:'SHIT trader'}])expect((await POST(request(body))).status).toBe(400);expect(mock.rpc).not.toHaveBeenCalled();
});
it('reports collisions and authorization loss without leaking database errors',async()=>{
 mock.rpc.mockResolvedValue({error:{code:'23505',message:'duplicate longboard_chat_member_name_idx'}});expect((await POST(request({action:'rename',displayName:'Alice'}))).status).toBe(409);
 mock.rpc.mockResolvedValue({error:{message:'member_required secret internals'}});const response=await POST(request({action:'rename',displayName:'Alice'}));expect(response.status).toBe(403);expect(JSON.stringify(await response.json())).not.toContain('secret');
});
