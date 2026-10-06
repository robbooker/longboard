import {beforeEach,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const mock=vi.hoisted(()=>({auth:vi.fn(),member:vi.fn(),from:vi.fn(),calls:[] as unknown[][],results:[] as unknown[]}));
vi.mock('@/lib/chatAuth',()=>({requireChatUser:mock.auth}));
vi.mock('@/lib/chatMembers',()=>({findChatMember:mock.member,CHAT_UUID:/^[0-9a-f-]{36}$/i}));
vi.mock('@/lib/chatAdmin',()=>({createChatAdminClient:()=>({from:mock.from})}));
import {GET} from '@/app/api/chat/opening/route';
const id='10000000-0000-4000-8000-000000000001';
const req=(query='room=main')=>new NextRequest(`https://chat.test/api/chat/opening?${query}`);
const ok=(data:unknown)=>({data,error:null});
beforeEach(()=>{
 vi.clearAllMocks();mock.calls=[];mock.results=[];
 mock.auth.mockResolvedValue({ok:true,user:{id:'account'},access:{longboard:true,boardroom:true,shortscout:false,admin:false}});
 mock.member.mockResolvedValue({id:'member'});
 mock.from.mockImplementation((table:string)=>{
  const result=mock.results.shift();const q:Record<string,unknown>={then:(resolve:(v:unknown)=>void)=>Promise.resolve(result).then(resolve)};
  for(const op of ['select','eq','or','neq','is','gt','order','limit','maybeSingle'])q[op]=(...args:unknown[])=>{mock.calls.push([table,op,...args]);return q;};return q;
 });
});
it('requires verified auth before database reads',async()=>{mock.auth.mockResolvedValue({ok:false,error:'unauthorized',status:401});expect((await GET(req())).status).toBe(401);expect(mock.from).not.toHaveBeenCalled();});
it('rejects malformed targets and inaccessible rooms',async()=>{expect((await GET(req('conversation=bad'))).status).toBe(400);expect((await GET(req('room=shortscout'))).status).toBe(403);expect(mock.from).not.toHaveBeenCalled();});
it('requires a member derived from the authenticated account',async()=>{mock.member.mockResolvedValue(null);expect((await GET(req())).status).toBe(403);expect(mock.member).toHaveBeenCalledWith(expect.anything(),'account');});
it('selects oldest incoming unread and maps replies to their exact branch and visible root',async()=>{
 mock.results=[ok({through_seq:50}),ok([{id:'reply',reply_to_id:'parent',unread_seq:51}]),ok([{unread_seq:99}]),ok({id:'parent',reply_to_id:'root'}),ok({id:'root',reply_to_id:null})];
 const response=await GET(req());expect(await response.json()).toEqual({messageId:'root',unreadMessageId:'reply',parentId:'parent',readThrough:51,latestThrough:99});
 expect(response.headers.get('cache-control')).toContain('no-store');
 expect(mock.calls).toContainEqual(['chat_room_reads','eq','account_id','account']);
 expect(mock.calls).toContainEqual(['longboard_chat_messages','gt','unread_seq',50]);
 expect(mock.calls).toContainEqual(['longboard_chat_messages','order','unread_seq',{ascending:true}]);
 expect(mock.calls).toContainEqual(['longboard_chat_messages','or','member_id.is.null,member_id.neq.member']);
 expect(mock.calls.filter(row=>row[0]==='longboard_chat_messages'&&row[1]==='eq'&&row[2]==='room_slug')).toHaveLength(4);
});
it('returns latest fallback only when nothing is unread',async()=>{mock.results=[ok(null),ok([]),ok([])];expect(await (await GET(req())).json()).toEqual({messageId:null,unreadMessageId:null,parentId:null,readThrough:0,latestThrough:0});});
it('skips an unavailable ancestor without losing the next valid unread root',async()=>{
 mock.results=[ok(null),ok([{id:'reply',reply_to_id:'gone',unread_seq:4},{id:'root',reply_to_id:null,unread_seq:5}]),ok([{unread_seq:20}]),ok(null)];
 expect(await (await GET(req())).json()).toEqual({messageId:'root',unreadMessageId:'root',parentId:null,readThrough:5,latestThrough:20});
});
it('keeps read paused when only an unavailable branch was found in the bounded candidate page',async()=>{mock.results=[ok(null),ok([{id:'reply',reply_to_id:'gone',unread_seq:4}]),ok([{unread_seq:4}]),ok(null)];expect((await GET(req())).status).toBe(503);});
it('bounds cyclic parent traversal without consuming unread',async()=>{mock.results=[ok(null),ok([{id:'reply',reply_to_id:'reply',unread_seq:4}]),ok([{unread_seq:4}]),ok({id:'reply',reply_to_id:'reply'})];expect((await GET(req())).status).toBe(503);expect(mock.from).toHaveBeenCalledTimes(4);});
it.each([true,false])('selected thread advances the room boundary only if it contains the global oldest: %s',async same=>{
 mock.results=[ok({through_seq:10}),ok([{id:same?'child':'elsewhere',unread_seq:11}]),ok([{unread_seq:50}]),ok({id}),ok([{id:'child',unread_seq:same?11:20}])];
 expect(await (await GET(req(`room=main&thread=${id}`))).json()).toEqual({messageId:'child',readThrough:same?11:0,latestThrough:50});
 expect(mock.calls).toContainEqual(['longboard_chat_messages','eq','reply_to_id',id]);
});
it('rejects unavailable and cross-room thread originals',async()=>{mock.results=[ok(null),ok([]),ok([]),ok(null)];expect((await GET(req(`room=main&thread=${id}`))).status).toBe(404);});
it('denies another member’s DM without querying its messages',async()=>{mock.results=[ok(null)];expect((await GET(req(`conversation=${id}`))).status).toBe(404);expect(mock.calls).toContainEqual(['longboard_chat_conversations','or','requester_id.eq.member,recipient_id.eq.member']);expect(mock.from).toHaveBeenCalledTimes(1);});
it('denies declined conversations',async()=>{mock.results=[ok({status:'declined'})];expect((await GET(req(`conversation=${id}`))).status).toBe(404);});
it('denies either-direction blocks',async()=>{mock.results=[ok({requester_id:'member',recipient_id:'other',status:'accepted'}),ok([{blocker_id:'other'}])];expect((await GET(req(`conversation=${id}`))).status).toBe(404);expect(mock.from).toHaveBeenCalledTimes(2);});
it.each([['member','other',12],['other','member',34]])('uses correct participant read cursor %s',async(requester,recipient,cursor)=>{
 mock.results=[ok({requester_id:requester,recipient_id:recipient,requester_read_seq:12,recipient_read_seq:34,status:'accepted'}),ok([]),ok([{id:'unread'}])];
 expect(await (await GET(req(`conversation=${id}`))).json()).toEqual({messageId:'unread'});
 expect(mock.calls).toContainEqual(['longboard_chat_direct_messages','gt','seq',cursor]);
 expect(mock.calls).toContainEqual(['longboard_chat_direct_messages','order','seq',{ascending:true}]);
 expect(mock.calls).toContainEqual(['longboard_chat_direct_messages','is','deleted_at',null]);
 expect(mock.calls).toContainEqual(['longboard_chat_direct_messages','neq','sender_id','member']);
 expect(mock.calls).toContainEqual(['longboard_chat_direct_messages','eq','conversation_id',id]);
});
it('fails closed on database errors',async()=>{mock.results=[{error:{message:'failure'}}];expect((await GET(req())).status).toBe(503);});
