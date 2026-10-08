import {beforeEach,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const mocks=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn(),origin:vi.fn()}));
vi.mock('@/lib/chatAuth',()=>({requireChatUser:mocks.auth}));
vi.mock('@/lib/chatAdmin',()=>({createChatAdminClient:()=>({rpc:mocks.rpc}),requestOriginAllowed:mocks.origin}));
import {GET,POST} from '@/app/api/chat/activity/route';
import {forgetRecentActivity} from '@/lib/chatReads/activity';
const id='10000000-0000-4000-8000-000000000001';
const req=(body?:unknown)=>new NextRequest('https://example.test/api/chat/activity',body===undefined?{}:{method:'POST',body:JSON.stringify(body)});
beforeEach(()=>{vi.restoreAllMocks();forgetRecentActivity(id);vi.clearAllMocks();mocks.origin.mockReturnValue(true);mocks.auth.mockResolvedValue({ok:true,user:{id},access:{longboard:true,boardroom:true,shortscout:false,admin:false}});mocks.rpc.mockResolvedValue({data:{mentionCount:2,dmCount:1},error:null});});
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
it('acknowledges reaction events separately without moving room or DM message cursors',async()=>{
 await POST(req({kind:'reaction',id,reactionThrough:44,dmThrough:900,mentionThrough:800}));
 expect(mocks.rpc).toHaveBeenLastCalledWith('read_chat_activity_notifications',{actor:id,rooms:['main','social','lb-announcements','gainers','lb-recordings'],mention_through:0,mention_id:null,dm_through:0,dm_conversation:null,reaction_through:44,reaction_id:id});
});
it('includes the independent reaction snapshot in explicit all-read and rejects forged cursors',async()=>{
 await POST(req({kind:'all',mentionThrough:5,dmThrough:6,reactionThrough:7}));
 expect(mocks.rpc).toHaveBeenLastCalledWith('read_chat_activity_notifications',expect.objectContaining({mention_through:5,dm_through:6,reaction_through:7,reaction_id:null}));
 mocks.rpc.mockClear();
 for(const reactionThrough of [-1,1.5,'3',Number.MAX_SAFE_INTEGER+1])expect((await POST(req({kind:'reaction',id,reactionThrough}))).status).toBe(400);
 expect(mocks.rpc).not.toHaveBeenCalled();
});
it('serves old windows (no why) a recent bell for 10 s, never current windows or after a mark-read',async()=>{
 let now=Date.now()+1000;vi.spyOn(Date,'now').mockImplementation(()=>now);
 const get=(why?:string)=>GET(new NextRequest(`https://example.test/api/chat/activity${why?`?why=${why}`:''}`));
 expect((await get()).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledTimes(2);
 now+=9000;expect(await (await get()).json()).toEqual(expect.objectContaining({mentionCount:2}));expect(mocks.rpc).toHaveBeenCalledTimes(2);
 await get('timer');expect(mocks.rpc).toHaveBeenCalledTimes(4);
 now+=1;await get();expect(mocks.rpc).toHaveBeenCalledTimes(4);
 now+=10000;await get();expect(mocks.rpc).toHaveBeenCalledTimes(6);
 now+=1;await POST(req({kind:'all',mentionThrough:1,dmThrough:1}));expect(mocks.rpc).toHaveBeenCalledTimes(7);
 now+=1;await get();expect(mocks.rpc).toHaveBeenCalledTimes(9);
});
it('does not keep a bell read that was in flight during a mark-read',async()=>{
 let now=Date.now()+1000;vi.spyOn(Date,'now').mockImplementation(()=>now);
 let release!:()=>void;const gate=new Promise<void>((r)=>{release=r;});
 mocks.rpc.mockImplementation(async(name:string)=>{if(name==='chat_activity_inbox')await gate;return {data:{mentionCount:2},error:null};});
 const stale=GET(req());now+=5;await POST(req({kind:'all',mentionThrough:1,dmThrough:1}));release();await stale;
 mocks.rpc.mockClear();now+=5;await GET(req());expect(mocks.rpc).toHaveBeenCalledTimes(2);
});
it('logs slow bell reads with timings and a one-way account tag, never the id',async()=>{
 const info=vi.spyOn(console,'info').mockImplementation(()=>{});vi.spyOn(Math,'random').mockReturnValue(0.5);
 let clock=0;vi.spyOn(performance,'now').mockImplementation(()=>clock);
 mocks.rpc.mockImplementation(async(name:string)=>{if(name==='chat_activity_inbox')clock+=700;return {data:{},error:null};});
 await GET(new NextRequest('https://example.test/api/chat/activity?why=timer'));
 expect(info).toHaveBeenCalledTimes(1);const line=String(info.mock.calls[0][0]);
 expect(line).toMatch(/^\[chat-bell-time\] slow inbox=700 unread=700 inflight=1 acct=[0-9a-f]{8} why=timer$/);expect(line).not.toContain(id);
 info.mockClear();mocks.rpc.mockResolvedValue({data:{},error:null});
 await GET(new NextRequest('https://example.test/api/chat/activity?why=timer'));expect(info).not.toHaveBeenCalled();
});
