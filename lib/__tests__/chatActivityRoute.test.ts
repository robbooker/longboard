import {beforeEach,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const mocks=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn(),origin:vi.fn()}));
vi.mock('@/lib/chatAuth',()=>({requireChatUser:mocks.auth}));
vi.mock('@/lib/chatAdmin',()=>({createChatAdminClient:()=>({rpc:mocks.rpc}),requestOriginAllowed:mocks.origin}));
import {GET,POST} from '@/app/api/chat/activity/route';
const id='10000000-0000-4000-8000-000000000001';
const req=(body?:unknown)=>new NextRequest('https://example.test/api/chat/activity',body===undefined?{}:{method:'POST',body:JSON.stringify(body)});
beforeEach(()=>{vi.clearAllMocks();mocks.origin.mockReturnValue(true);mocks.auth.mockResolvedValue({ok:true,user:{id},access:{longboard:true,boardroom:true,shortscout:false,admin:false}});mocks.rpc.mockResolvedValue({data:{mentionCount:2,dmCount:1},error:null});});
it('requires authentication and rejects foreign origins',async()=>{
 mocks.auth.mockResolvedValue({ok:false,status:401,error:'unauthorized'});
 expect((await GET(req())).status).toBe(401);expect((await POST(req({kind:'all'}))).status).toBe(401);
 mocks.origin.mockReturnValue(false);expect((await POST(req({kind:'all'}))).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();
});
it('derives the account and room access from the session',async()=>{
 const response=await GET(req());expect(response.headers.get('cache-control')).toContain('no-store');
 expect(mocks.rpc).toHaveBeenCalledWith('chat_activity_inbox',{actor:id,rooms:['main','social','lb-announcements']});
 await POST(req({kind:'all',actor:'forged',rooms:['shortscout'],mentionThrough:4,dmThrough:9}));
 expect(mocks.rpc).toHaveBeenLastCalledWith('read_chat_activity',{actor:id,rooms:['main','social','lb-announcements'],mention_through:4,mention_id:null,dm_through:9,dm_conversation:null});
});
it('validates room access and snapshot cursors before writes',async()=>{
 expect((await POST(req({kind:'room',room:'shortscout',mentionThrough:1}))).status).toBe(403);
 for(const mentionThrough of [-1,1.2,'1',null,Number.MAX_SAFE_INTEGER+1])expect((await POST(req({kind:'all',mentionThrough,dmThrough:0}))).status).toBe(400);
 expect((await POST(req({kind:'mention',id:'bad',mentionThrough:1}))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();
});
it('keeps read actions scoped to their type and selected item',async()=>{
 await POST(req({kind:'dm',id,dmThrough:3,mentionThrough:100}));expect(mocks.rpc).toHaveBeenLastCalledWith('read_chat_activity',{actor:id,rooms:['main','social','lb-announcements'],mention_through:0,mention_id:null,dm_through:3,dm_conversation:id});
 await POST(req({kind:'room',room:'social',mentionThrough:2,dmThrough:99}));expect(mocks.rpc).toHaveBeenLastCalledWith('read_visible_chat_room_alerts',{actor:id,room:'social',through_seq:2});
});
it('reports database failures without pretending a read succeeded',async()=>{
 mocks.rpc.mockResolvedValue({error:{message:'failure'}});expect((await GET(req())).status).toBe(503);expect((await POST(req({kind:'all',mentionThrough:1,dmThrough:1}))).status).toBe(503);
});
