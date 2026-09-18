import {beforeEach,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const mocks=vi.hoisted(()=>({auth:vi.fn(),admin:vi.fn(),rpc:vi.fn()}));
vi.mock('@/lib/chatAuth',()=>({requireChatUser:mocks.auth}));
vi.mock('@/lib/chatAdmin',()=>({createChatAdminClient:mocks.admin}));
import {GET} from '@/app/api/chat/dm-members/route';
const req=(query='Alice')=>new NextRequest('https://example.test/api/chat/dm-members?q='+encodeURIComponent(query)+'&userId=forged&limit=999');
beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue({ok:true,user:{id:'verified-account'}});mocks.admin.mockReturnValue({rpc:mocks.rpc});mocks.rpc.mockResolvedValue({data:[]});});
it('requires verified chat access before creating the directory client',async()=>{mocks.auth.mockResolvedValue({ok:false,status:401,error:'unauthenticated'});expect((await GET(req())).status).toBe(401);expect(mocks.admin).not.toHaveBeenCalled();});
it('uses the verified caller, normalizes search, ignores forged actor/limit, and projects only public identity',async()=>{
 mocks.rpc.mockResolvedValue({data:[{id:'member-id',display_name:'Alice',user_id:'secret-account',email:'secret@example.test',accepts_requests:true}]});const response=await GET(req('  Ａlice  '));
 expect(mocks.rpc).toHaveBeenCalledWith('longboard_chat_dm_directory',{p_user_id:'verified-account',p_query:'Alice'});expect(await response.json()).toEqual({members:[{id:'member-id',display_name:'Alice'}]});expect(response.headers.get('cache-control')).toBe('private, no-store');
});
it.each(['','a','x'.repeat(29),'%','aa%','aa\\','aa,or','<script>','x'.repeat(113)])('rejects invalid or unbounded query %j',async query=>{expect((await GET(req(query))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();});
it('rejects multiple queries',async()=>{expect((await GET(new NextRequest('https://example.test/api/chat/dm-members?q=Alice&q=Bob'))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();});
it.each(['a_b',"O'Neil",'Élise','Ab-CD'])('allows literal valid chat-name search %s',async query=>{expect((await GET(req(query))).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('longboard_chat_dm_directory',expect.objectContaining({p_query:query}));});
it('fails closed for an unregistered caller and hides database details',async()=>{mocks.rpc.mockResolvedValue({error:{message:'member_required'}});expect((await GET(req())).status).toBe(403);mocks.rpc.mockResolvedValue({error:{message:'private schema details'}});const response=await GET(req());expect(response.status).toBe(503);expect(JSON.stringify(await response.json())).not.toContain('schema');});
it('returns a retryable error on transport failure',async()=>{mocks.rpc.mockRejectedValue(Error('secret credentials'));const response=await GET(req());expect(response.status).toBe(503);expect(JSON.stringify(await response.json())).not.toContain('credentials');});
