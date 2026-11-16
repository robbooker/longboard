import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const mocks=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn(),origin:vi.fn()}));
vi.mock('@/lib/chatAuth',()=>({requireChatUser:mocks.auth}));
vi.mock('@/lib/chatAdmin',()=>({createChatAdminClient:()=>({rpc:mocks.rpc}),requestOriginAllowed:mocks.origin}));
import {GET} from '@/app/api/chat/activity/route';
import {resetBellCountersForTests} from '@/lib/chatReads/activity';
import {CHAT_BELL_DRIFT_MS,CHAT_BELL_REPAIR_MS,chatBellCountDifferences,chatBellCountersRollout,chatBellCountsOnly,chatBellWantsLists} from '@/lib/chatBellCounters';
const id='10000000-0000-4000-8000-000000000001';
const rooms=['main','social','lb-announcements','gainers','lb-recordings','whats-new','developers','lb-review','runner-watch','club'];
const counts={roomLevels:{},replyNotifications:true,mentionCount:2,mentionThrough:9,roomCounts:{main:2},roomThrough:{main:9},pinnedDmUnread:{},dmCount:1,dmThrough:4,reactionCount:0,reactionThrough:0};
const inbox={...counts,mentions:[{id,seq:9,messageId:id,room:'main',author:'Bob',preview:'hi',createdAt:'2026-10-24T00:00:00Z'}],dms:[],reactions:[]};
const unread={roomMessageCounts:{main:3},roomMessageThrough:{main:40}};
const get=(query='why=timer&lists=0')=>GET(new NextRequest(`https://example.test/api/chat/activity?${query}`));
const called=()=>mocks.rpc.mock.calls.map(c=>c[0]).sort();
let rpcs:Record<string,unknown>;
beforeEach(()=>{
 resetBellCountersForTests();vi.clearAllMocks();mocks.origin.mockReturnValue(true);
 mocks.auth.mockResolvedValue({ok:true,user:{id},access:{longboard:true,boardroom:true,shortscout:false,admin:false}});
 rpcs={chat_activity_inbox:{data:inbox,error:null},chat_room_unread:{data:unread,error:null},chat_activity_counts:{data:counts,error:null}};
 mocks.rpc.mockImplementation(async(name:string)=>rpcs[name]);
});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});

it('parses the rollout, unknown values meaning off',()=>{
 for(const v of ['compare','admins','all'] as const)expect(chatBellCountersRollout(v)).toBe(v);
 for(const v of [undefined,'','on','ALL'])expect(chatBellCountersRollout(v)).toBe('off');
});
it('compares only the numbers, treating equal numbers from either function as equal',()=>{
 expect(chatBellCountDifferences(inbox,counts)).toEqual([]);
 expect(chatBellCountDifferences({...inbox,mentionCount:3,roomCounts:{main:3}},counts)).toEqual(['mentionCount','roomCounts']);
 expect(chatBellCountDifferences({...inbox,pinnedDmUnread:{[id]:0}},counts)).toEqual(['pinnedDmUnread']);
 expect(chatBellCountsOnly({...counts,extra:1})).toEqual({...counts,mentions:[],dms:[],reactions:[],lists:false});
});
it('off (the default): every read runs the inbox, as before',async()=>{
 const body=await (await get()).json();
 expect(called()).toEqual(['chat_activity_inbox','chat_room_unread']);expect(body.mentions).toHaveLength(1);expect(body.lists).toBeUndefined();
});
it('all: the closed bell reads the counters; the open bell and old windows still read the inbox',async()=>{
 vi.stubEnv('CHAT_BELL_COUNTERS','all');
 const body=await (await get()).json();
 expect(called()).toEqual(['chat_activity_counts','chat_room_unread']);
 expect(mocks.rpc).toHaveBeenCalledWith('chat_activity_counts',{actor:id,rooms});
 expect(body).toEqual({...counts,...unread,mentions:[],dms:[],reactions:[],lists:false});
 for(const query of ['why=lists&lists=1','why=timer','why=api']){
  mocks.rpc.mockClear();const full=await (await get(query)).json();
  // #462: a window's full read (lists=1) checks the counters beside the inbox; other reads do not.
  expect(called()).toEqual(query.includes('lists=1')?['chat_activity_counts','chat_activity_inbox','chat_room_unread']:['chat_activity_inbox','chat_room_unread']);
  expect(full.mentions).toHaveLength(1);expect(full.lists).toBeUndefined();
 }
});
it('#462: the closed bell asks for the lists on its first read and then every few minutes',()=>{
 expect(CHAT_BELL_REPAIR_MS).toBe(300_000);
 expect(chatBellWantsLists(0,undefined,1000)).toBe(true);
 expect(chatBellWantsLists(0,1000,1000+CHAT_BELL_REPAIR_MS-1)).toBe(false);
 expect(chatBellWantsLists(0,1000,1000+CHAT_BELL_REPAIR_MS)).toBe(true);
 expect(chatBellWantsLists(1,1000,1001)).toBe(true);
});
it('#462: counters that disagree with the repair read send that person to the inbox for a while',async()=>{
 vi.stubEnv('CHAT_BELL_COUNTERS','all');
 const log=vi.spyOn(console,'info').mockImplementation(()=>{});vi.spyOn(Math,'random').mockReturnValue(0.5);
 let now=Date.now()+1000;vi.spyOn(Date,'now').mockImplementation(()=>now);
 // A matching repair read changes nothing and logs nothing.
 await get('why=timer&lists=1');expect(log).not.toHaveBeenCalled();
 mocks.rpc.mockClear();await get();expect(called()).toEqual(['chat_activity_counts','chat_room_unread']);
 // A drifted counter: logged, and the closed bell's numbers come from the inbox.
 rpcs.chat_activity_counts={data:{...counts,mentionCount:5},error:null};
 mocks.rpc.mockClear();const repaired=await (await get('why=timer&lists=1')).json();
 expect(repaired.mentionCount).toBe(2);expect(log).toHaveBeenCalledTimes(1);
 expect(String(log.mock.calls[0][0])).toMatch(/^\[chat-bell-counters\] mismatch acct=[0-9a-f]{8} fields=mentionCount inbox=\{"mentionCount":2\} counters=\{"mentionCount":5\}$/);
 mocks.rpc.mockClear();const closed=await (await get()).json();
 expect(called()).toEqual(['chat_activity_inbox','chat_room_unread']);expect(closed.mentionCount).toBe(2);
 // Another person is not affected.
 const other='10000000-0000-4000-8000-000000000002';
 mocks.auth.mockResolvedValueOnce({ok:true,user:{id:other},access:{longboard:true,boardroom:true,shortscout:false,admin:false}});
 mocks.rpc.mockClear();await get();expect(called()).toEqual(['chat_activity_counts','chat_room_unread']);
 // Once the time is up, the counters again.
 now+=CHAT_BELL_DRIFT_MS;mocks.rpc.mockClear();await get();expect(called()).toEqual(['chat_activity_counts','chat_room_unread']);
 // A repair read that matches again ends the inbox fallback early.
 await get('why=timer&lists=1');mocks.rpc.mockClear();await get();expect(called()).toEqual(['chat_activity_inbox','chat_room_unread']);
 rpcs.chat_activity_counts={data:counts,error:null};await get('why=timer&lists=1');
 mocks.rpc.mockClear();await get();expect(called()).toEqual(['chat_activity_counts','chat_room_unread']);
});
it('admins: only admins read the counters',async()=>{
 vi.stubEnv('CHAT_BELL_COUNTERS','admins');
 await get();expect(called()).toEqual(['chat_activity_inbox','chat_room_unread']);
 mocks.rpc.mockClear();mocks.auth.mockResolvedValue({ok:true,user:{id},access:{longboard:true,boardroom:true,shortscout:false,admin:true}});
 await get();expect(called()).toEqual(['chat_activity_counts','chat_room_unread']);
});
it('falls back to the inbox when the counters are missing (migration not applied) or fail, never to zeros',async()=>{
 vi.stubEnv('CHAT_BELL_COUNTERS','all');
 let now=Date.now()+1000;vi.spyOn(Date,'now').mockImplementation(()=>now);
 rpcs.chat_activity_counts={data:null,error:{code:'PGRST202',message:'Could not find the function public.chat_activity_counts'}};
 const body=await (await get()).json();
 expect(called()).toEqual(['chat_activity_counts','chat_activity_inbox','chat_room_unread']);expect(body.mentions).toHaveLength(1);
 // For the next minute it does not ask again.
 mocks.rpc.mockClear();now+=30_000;await get();expect(called()).toEqual(['chat_activity_inbox','chat_room_unread']);
 mocks.rpc.mockClear();now+=31_000;rpcs.chat_activity_counts={data:counts,error:null};await get();expect(called()).toEqual(['chat_activity_counts','chat_room_unread']);
 mocks.rpc.mockClear();rpcs.chat_activity_counts={data:null,error:{code:'57014',message:'timeout'}};
 expect((await (await get()).json()).mentionCount).toBe(2);expect(called()).toContain('chat_activity_inbox');
});
it('compare: serves the inbox and logs only differing numbers, with a one-way account tag',async()=>{
 vi.stubEnv('CHAT_BELL_COUNTERS','compare');
 const log=vi.spyOn(console,'info').mockImplementation(()=>{});vi.spyOn(Math,'random').mockReturnValue(0.5);
 const body=await (await get()).json();
 expect(called()).toEqual(['chat_activity_counts','chat_activity_inbox','chat_room_unread']);expect(body.mentions).toHaveLength(1);expect(log).not.toHaveBeenCalled();
 rpcs.chat_activity_counts={data:{...counts,dmCount:2},error:null};await get();
 expect(log).toHaveBeenCalledTimes(1);const line=String(log.mock.calls[0][0]);
 expect(line).toMatch(/^\[chat-bell-counters\] mismatch acct=[0-9a-f]{8} fields=dmCount inbox=\{"dmCount":1\} counters=\{"dmCount":2\}$/);
 expect(line).not.toContain(id);expect(line).not.toContain('hi');
});
