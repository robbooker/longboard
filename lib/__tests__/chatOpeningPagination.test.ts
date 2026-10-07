import {beforeEach,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const mock=vi.hoisted(()=>({from:vi.fn(),calls:[] as unknown[][],results:[] as unknown[]}));
vi.mock('@/lib/chatMembers',()=>({findChatMember:async()=>({id:'member'}),CHAT_UUID:/^[0-9a-f-]{36}$/i}));
vi.mock('@/lib/chatAdmin',()=>({createChatAdminClient:()=>({from:mock.from})}));
import {readInbox} from '@/lib/chatReads/inbox';
import {readHistory} from '@/lib/chatReads/history';
const id='10000000-0000-4000-8000-000000000001',anchor='20000000-0000-4000-8000-000000000001';
const auth={ok:true as const,user:{id:'account'},access:{longboard:true,boardroom:true,shortscout:false,admin:false}} as Parameters<typeof readInbox>[1];
const req=(q:string)=>new NextRequest(`https://chat.test/api/chat/inbox?conversation=${id}&${q}`);
const ok=(data:unknown)=>({data,error:null});
const conversation={id,requester_id:'member',recipient_id:'other',status:'accepted'};
beforeEach(()=>{
 mock.calls=[];mock.results=[];
 mock.from.mockImplementation((table:string)=>{
  const result=mock.results.shift();const q:Record<string,unknown>={then:(resolve:(v:unknown)=>void)=>Promise.resolve(result).then(resolve)};
  for(const op of ['select','eq','or','neq','is','gt','lt','gte','lte','in','order','limit','maybeSingle'])q[op]=(...args:unknown[])=>{mock.calls.push([table,op,...args]);return q;};return q;
 });
});
it('returns bounded contiguous context with both pagination flags',async()=>{
 mock.results=[ok(conversation),ok([]),ok({id:anchor,seq:100}),ok(Array.from({length:26},(_,i)=>({seq:99-i}))),ok(Array.from({length:26},(_,i)=>({seq:101+i})))];
 const result=await(await readInbox(req(`around=${anchor}`),auth)).json();
 expect(result.messages.map((m:{seq:number})=>m.seq)).toEqual(Array.from({length:51},(_,i)=>75+i));expect(result.hasMore).toBe(true);expect(result.hasNewer).toBe(true);
 expect(mock.calls).toContainEqual(['longboard_chat_direct_messages','eq','conversation_id',id]);
 expect(mock.calls.filter(row=>row[1]==='limit'&&row[2]===26)).toHaveLength(2);
});
it('rejects missing or cross-conversation anchors',async()=>{mock.results=[ok(conversation),ok([]),ok(null)];expect((await readInbox(req(`around=${anchor}`),auth)).status).toBe(404);});
it('returns forward pages oldest first and preserves an explicit gap flag',async()=>{
 mock.results=[ok(conversation),ok([]),ok(Array.from({length:51},(_,i)=>({seq:126+i})))];
 const result=await(await readInbox(req('after=125'),auth)).json();expect(result.messages).toHaveLength(50);expect(result.messages[0].seq).toBe(126);expect(result.messages[49].seq).toBe(175);expect(result.hasNewer).toBe(true);
 expect(mock.calls).toContainEqual(['longboard_chat_direct_messages','gt','seq','125']);expect(mock.calls).toContainEqual(['longboard_chat_direct_messages','order','seq',{ascending:true}]);
});
it.each(['around=bad','after=-1',`around=${anchor}&before=20`,`after=1&ids=${anchor}`])('rejects invalid or ambiguous pagination %s',async q=>{mock.results=[ok(conversation)];expect((await readInbox(req(q),auth)).status).toBe(400);});
it('blocks context paging into unavailable conversations',async()=>{mock.results=[ok(conversation),ok([{blocker_id:'other'}])];expect((await readInbox(req(`around=${anchor}`),auth)).status).toBe(404);});
it('retains an authorized old root without expanding the whole room history',async()=>{
 mock.results=[ok([{id:'latest'}]),ok({id:anchor}),ok([])];
 const result=await(await readHistory(new NextRequest(`https://chat.test/api/chat/history?room=main&anchor=${anchor}`),auth)).json();expect(result.messages.map((m:{id:string})=>m.id)).toEqual([anchor,'latest']);
 expect(mock.calls).toContainEqual(['longboard_chat_messages','eq','room_slug','main']);expect(mock.calls).toContainEqual(['longboard_chat_messages','is','reply_to_id',null]);expect(mock.calls).toContainEqual(['longboard_chat_messages','limit',80]);
});
it('returns canonical hidden deletion evidence for known room IDs even if the visible query raced deletion',async()=>{
 const live={id:anchor,body:'Old body',revision:0,removed:false};const gone={...live,body:'Message deleted',revision:1,removed:true};
 mock.results=[ok([live]),ok([gone])];
 const result=await(await readHistory(new NextRequest(`https://chat.test/api/chat/history?room=main&ids=${anchor}`),auth)).json();
 expect(result.messages).toHaveLength(1);expect(result.messages[0]).toMatchObject(gone);
 expect(mock.calls).toContainEqual(['longboard_chat_messages','eq','removed',true]);
 expect(mock.calls).toContainEqual(['longboard_chat_messages','in','id',[anchor]]);
 expect(mock.calls.filter(row=>row[1]==='eq'&&row[2]==='room_slug')).toEqual([['longboard_chat_messages','eq','room_slug','main'],['longboard_chat_messages','eq','room_slug','main']]);
});
it('rejects invalid or unbounded room reconciliation IDs before reading data',async()=>{
 for(const ids of ['not-a-uuid',Array(201).fill(anchor).join(',')])expect((await readHistory(new NextRequest(`https://chat.test/api/chat/history?room=main&ids=${ids}`),auth)).status).toBe(400);
 expect(mock.calls).toEqual([]);
});

it('latest captures all-room sequence before querying bounded roots, including reply-only unread',async()=>{
 mock.results=[ok([{unread_seq:900}]),ok([{id:'root',unread_seq:800}]),ok([])];
 const result=await(await readHistory(new NextRequest('https://chat.test/api/chat/history?room=main&latest=1'),auth)).json();
 expect(result.latestThrough).toBe(900);expect(result.messages).toHaveLength(1);
 expect(mock.calls).toContainEqual(['longboard_chat_messages','lte','unread_seq',900]);
 expect(mock.calls.filter(row=>row[1]==='is'&&row[2]==='reply_to_id')).toHaveLength(1);
});

it('starts the known-ID deletion read without waiting for the visible history query',async()=>{
 let release!:()=>void;const visibleGate=new Promise<void>(resolve=>{release=resolve;});
 const started:string[]=[];
 // Resolve by query shape, not call order, so the test fails if the reads are serialized.
 mock.from.mockImplementation((table:string)=>{
  const ops:unknown[][]=[];const q:Record<string,unknown>={then:(resolve:(v:unknown)=>void)=>{
   const removed=ops.find(op=>op[0]==='eq'&&op[1]==='removed')?.[2];
   const kind=table==='longboard_chat_reactions'?'reactions':removed===true?'deleted':'visible';started.push(kind);
   return (kind==='visible'?visibleGate.then(()=>ok([{id:'latest'}])):Promise.resolve(ok([]))).then(resolve);
  }};
  for(const op of ['select','eq','or','neq','is','gt','lt','gte','lte','in','order','limit','maybeSingle'])q[op]=(...args:unknown[])=>{ops.push([op,...args]);return q;};return q;
 });
 const pending=readHistory(new NextRequest(`https://chat.test/api/chat/history?room=main&ids=${anchor}`),auth);
 await new Promise(resolve=>setTimeout(resolve,0));
 expect(started).toEqual(expect.arrayContaining(['visible','deleted']));
 release();
 expect((await pending).status).toBe(200);
});
