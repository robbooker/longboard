import {beforeEach,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const mocks=vi.hoisted(()=>({auth:vi.fn(),origin:vi.fn(),rpc:vi.fn(),from:vi.fn(),find:vi.fn(),room:vi.fn(),summaries:vi.fn()}));
vi.mock('@/lib/chatAuth',()=>({requireChatUser:mocks.auth}));
vi.mock('@/lib/chatAdmin',()=>({requestOriginAllowed:mocks.origin,createChatAdminClient:()=>({rpc:mocks.rpc,from:mocks.from}),readPublicRoomState:mocks.room}));
vi.mock('@/lib/chatMembers',()=>({findChatMember:mocks.find,CHAT_UUID:/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i}));
vi.mock('@/lib/chatRoomSummary',()=>({SUMMARY_THREAD:'room-summaries',summaryConversation:mocks.summaries}));
import {POST} from '@/app/api/chat/updates/route';
const actor='10000000-0000-4000-8000-000000000001',conversation='20000000-0000-4000-8000-000000000001';
function query(data:unknown=null,error:unknown=null){
 const result={data,error};const q:Record<string,unknown>={};
 for(const method of ['select','eq','in','or','is','order','limit','lt'])q[method]=vi.fn(()=>q);
 q.maybeSingle=vi.fn(async()=>result);q.then=(resolve:(x:unknown)=>unknown)=>Promise.resolve(result).then(resolve);return q;
}
const req=(paths:unknown)=>new NextRequest('https://longboard.test/api/chat/updates',{method:'POST',body:JSON.stringify({paths})});
beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue({ok:true,user:{id:actor,role:'user'},access:{longboard:true,boardroom:false,shortscout:false,admin:false},serverSession:false});mocks.origin.mockReturnValue(true);mocks.find.mockResolvedValue({id:actor});mocks.rpc.mockResolvedValue({data:{},error:null});mocks.from.mockImplementation(()=>query());mocks.room.mockResolvedValue({isOpen:true});mocks.summaries.mockResolvedValue(null);});
it('requires a same-origin request and a verified session before database reads',async()=>{
 mocks.origin.mockReturnValue(false);expect((await POST(req(['/api/chat/activity']))).status).toBe(403);expect(mocks.auth).not.toHaveBeenCalled();
 mocks.origin.mockReturnValue(true);mocks.auth.mockResolvedValue({ok:false,status:401,error:'unauthenticated'});
 expect((await POST(req(['/api/chat/activity']))).status).toBe(401);expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.from).not.toHaveBeenCalled();
});
it('resolves identity once for multiple resources and ignores caller-supplied actors/rooms',async()=>{
 const response=await POST(req(['/api/chat/activity?actor=forged&rooms=main','/api/chat?room=social']));
 expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('private, no-store');expect(mocks.auth).toHaveBeenCalledTimes(1);
 expect(mocks.rpc).toHaveBeenCalledWith('chat_activity_inbox',{actor,rooms:['social']});expect((await response.json()).results).toHaveLength(2);
});
it('retains room access checks for status, history, counts and threads',async()=>{
 const response=await POST(req(['/api/chat?room=main','/api/chat/history?room=main',`/api/chat/thread-counts?room=main&ids=${conversation}`,`/api/chat/thread?room=main&messageId=${conversation}`]));
 expect((await response.json()).results.map((r:{status:number})=>r.status)).toEqual([403,403,403,403]);expect(mocks.from).not.toHaveBeenCalled();expect(mocks.room).not.toHaveBeenCalled();
});
it('retains private conversation participant checks and never reads foreign messages',async()=>{
 const q=query(null);mocks.from.mockReturnValue(q);
 const response=await POST(req([`/api/chat/inbox?conversation=${conversation}&actor=forged`]));
 expect((await response.json()).results[0].status).toBe(404);
 expect(q.or).toHaveBeenCalledWith(`requester_id.eq.${actor},recipient_id.eq.${actor}`);expect(mocks.find).toHaveBeenCalledWith(expect.anything(),actor);
 expect(mocks.from).not.toHaveBeenCalledWith('longboard_chat_direct_messages');
});
it('does not equate ordinary chat membership with private feature access',async()=>{
 const response=await POST(req(['/api/chat/features/notifications']));expect((await response.json()).results[0].status).toBe(404);
 expect(mocks.from).toHaveBeenCalledWith('chat_feature_members');expect(mocks.from).not.toHaveBeenCalledWith('chat_feature_notifications');expect(mocks.auth).toHaveBeenCalledTimes(1);
});
it('uses the verified cookie-only account and authoritative entitlements',async()=>{
 mocks.auth.mockResolvedValue({ok:true,user:{id:actor},access:{longboard:false,shortscout:true,admin:false},serverSession:true});
 const response=await POST(req(['/api/chat/activity','/api/chat?room=shortscout']));expect((await response.json()).results.every((r:{status:number})=>r.status===200)).toBe(true);
 expect(mocks.rpc).toHaveBeenCalledWith('chat_activity_inbox',{actor,rooms:['social','shortscout','ss-announcements']});
});
it('contains resource failures without dropping successful sibling updates',async()=>{
 mocks.rpc.mockResolvedValue({error:{message:'temporary'}});const response=await POST(req(['/api/chat/activity','/api/chat?room=social']));
 expect((await response.json()).results.map((r:{status:number})=>r.status)).toEqual([503,200]);
});
it('rejects arbitrary routes, remote URLs, duplicate work and oversized batches',async()=>{
 for(const paths of [null,[],Array(9).fill('/api/chat/activity'),['/api/chat/activity','/api/chat/activity'],['https://evil.test/api/chat'],['/api/chat/admin'],['/api/chat/updates'],['/api/chat/features'],[{},'/api/chat/activity'],['//evil.test/api/chat'],['/api/chat#fragment']])expect((await POST(req(paths))).status).toBe(400);
 expect((await POST(req(['/api/chat?'+ 'x'.repeat(40000)]))).status).toBe(413);expect(mocks.auth).not.toHaveBeenCalled();
});
it('keeps resource validation and read-only behavior',async()=>{
 const response=await POST(req(['/api/chat/thread-counts?room=social&ids=invalid','/api/chat/inbox?conversation=invalid','/api/chat/thread?room=social&messageId=invalid','/api/chat?room=invalid']));
 expect((await response.json()).results.map((r:{status:number})=>r.status)).toEqual([400,400,400,400]);expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.from).not.toHaveBeenCalled();
});
