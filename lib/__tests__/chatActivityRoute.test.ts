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
 expect(mocks.rpc).toHaveBeenCalledWith('chat_activity_inbox',{actor:id,rooms:['main','social','lb-announcements','gainers','lb-recordings']});
 await POST(req({kind:'all',actor:'forged',rooms:['shortscout'],mentionThrough:4,dmThrough:9}));
 expect(mocks.rpc).toHaveBeenLastCalledWith('read_chat_activity',{actor:id,rooms:['main','social','lb-announcements','gainers','lb-recordings'],mention_through:4,mention_id:null,dm_through:9,dm_conversation:null});
});
it('validates room access and snapshot cursors before writes',async()=>{
 expect((await POST(req({kind:'room',room:'shortscout',mentionThrough:1}))).status).toBe(403);
 for(const mentionThrough of [-1,1.2,'1',null,Number.MAX_SAFE_INTEGER+1])expect((await POST(req({kind:'all',mentionThrough,dmThrough:0}))).status).toBe(400);
 expect((await POST(req({kind:'mention',id:'bad',mentionThrough:1}))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();
});
it('keeps read actions scoped to their type and selected item',async()=>{
 await POST(req({kind:'dm',id,dmThrough:3,mentionThrough:100}));expect(mocks.rpc).toHaveBeenLastCalledWith('read_chat_activity',{actor:id,rooms:['main','social','lb-announcements','gainers','lb-recordings'],mention_through:0,mention_id:null,dm_through:3,dm_conversation:id});
 mocks.rpc.mockClear();await POST(req({kind:'room',room:'social',mentionThrough:2,dmThrough:99,roomThrough:8}));expect(mocks.rpc).toHaveBeenCalledTimes(1);expect(mocks.rpc).toHaveBeenCalledWith('read_chat_room',{actor:id,room:'social',through_seq:8});
});
it('acknowledges exact visible targets with independent observed event boundaries',async()=>{
 expect((await POST(req({kind:'visible',actor:'forged',scope:{kind:'room',room:'main'},messageIds:[id],mentionThrough:11,reactionThrough:3}))).status).toBe(200);
 expect(mocks.rpc).toHaveBeenLastCalledWith('read_visible_chat_notifications',{actor:id,p_room:'main',p_conversation:null,p_message_ids:[id],p_mention_through:11,p_reaction_through:3});
 expect((await POST(req({kind:'visible',scope:{kind:'dm',conversationId:id},messageIds:[id],mentionThrough:0,reactionThrough:4}))).status).toBe(200);
 expect(mocks.rpc).toHaveBeenLastCalledWith('read_visible_chat_notifications',{actor:id,p_room:null,p_conversation:id,p_message_ids:[id],p_mention_through:0,p_reaction_through:4});
});
it('rejects invalid, unbounded, duplicate and cross-scope visible snapshots',async()=>{
 const body={kind:'visible',scope:{kind:'room',room:'main'},messageIds:[id],mentionThrough:2,reactionThrough:3};
 for(const patch of [{messageIds:[]},{messageIds:[id,id]},{messageIds:Array(101).fill(id)},{messageIds:['wrong']},{mentionThrough:null},{reactionThrough:-1},{reactionThrough:1.5},{scope:{kind:'room',room:'main',conversationId:id}},{scope:{kind:'dm',conversationId:id}},{scope:{kind:'dm',conversationId:'bad'},mentionThrough:0}])expect((await POST(req({...body,...patch}))).status).toBe(400);
 expect((await POST(req({...body,scope:{kind:'room',room:'shortscout'}}))).status).toBe(403);
 expect(mocks.rpc).not.toHaveBeenCalled();
});
it('does not acknowledge a visible read if scope is revoked or the database fails',async()=>{
 const body={kind:'visible',scope:{kind:'dm',conversationId:id},messageIds:[id],mentionThrough:0,reactionThrough:3};
 mocks.rpc.mockResolvedValue({error:{message:'conversation_unavailable'}});expect((await POST(req(body))).status).toBe(403);
 mocks.rpc.mockResolvedValue({error:{message:'failure'}});expect((await POST(req(body))).status).toBe(503);
});
it('reports database failures without pretending a read succeeded',async()=>{
 mocks.rpc.mockResolvedValue({error:{message:'failure'}});expect((await GET(req())).status).toBe(503);expect((await POST(req({kind:'all',mentionThrough:1,dmThrough:1}))).status).toBe(503);
});
