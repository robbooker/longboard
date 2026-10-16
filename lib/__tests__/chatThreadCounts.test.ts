import {beforeEach,it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {mergeRoomMessage,type PublicChatMessage} from '@/lib/publicChat';
const m=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn()}));
vi.mock('@/lib/chatAuth',()=>({requireChatUser:m.auth}));
vi.mock('@/lib/chatAdmin',()=>({createChatAdminClient:()=>({rpc:m.rpc})}));
import {GET} from '@/app/api/chat/thread-counts/route';
const id='10000000-0000-4000-8000-000000000001';
const req=(room='main',ids=id)=>new NextRequest(`https://example.test/api/chat/thread-counts?room=${room}&ids=${ids}`);
beforeEach(()=>{vi.clearAllMocks();m.auth.mockResolvedValue({ok:true,access:{longboard:true,boardroom:true,shortscout:false}});m.rpc.mockResolvedValue({data:[{message_id:id,reply_count:3}],error:null});});
it('gates counts by authentication and membership',async()=>{expect((await GET(req('shortscout'))).status).toBe(403);m.auth.mockResolvedValue({ok:false,error:'unauthorized',status:401});expect((await GET(req())).status).toBe(401);expect(m.rpc).not.toHaveBeenCalled();});
it('validates and bounds ids and scopes aggregates to the room',async()=>{expect((await GET(req('main','bad'))).status).toBe(400);const result=await GET(req());expect(await result.json()).toEqual({counts:{[id]:3}});expect(m.rpc).toHaveBeenCalledWith('chat_thread_summaries',{p_room:'main',p_ids:[id]});expect(result.headers.get('cache-control')).toContain('no-store');});
it('fails closed when counts cannot load',async()=>{m.rpc.mockResolvedValue({error:{message:'failure'}});expect((await GET(req())).status).toBe(503);});
it('keeps human and bot replies out of the room without evicting roots',()=>{const root:PublicChatMessage={id,guest_id:'a',author_label:'A',body:'Root',created_at:'2026-09-16T00:00:00Z'};for(const bot_slug of [null,'buddy'])expect(mergeRoomMessage([root],{...root,id:'child',reply_to_id:id,bot_slug})).toEqual([root]);expect(mergeRoomMessage([],{...root,reply_to_id:null})).toEqual([{...root,reply_to_id:null}]);});
it('adds the newest reply time and up to three distinct repliers, newest first',async()=>{
 const member='20000000-0000-4000-8000-000000000001';
 m.rpc.mockResolvedValue({data:[{message_id:id,reply_count:5,last_reply_at:'2026-10-15T12:00:00Z',repliers:[{member,guest:'g1',bot:null,name:'Ann Lee'},{member:null,guest:null,bot:'buddy',name:'Buddy'},{member,guest:'g1',bot:null,name:'Ann Lee'},{member:null,guest:'g2',bot:null,name:'Guest'},{member:null,guest:'g3',bot:null,name:'Fourth'}]}],error:null});
 expect(await (await GET(req())).json()).toEqual({counts:{[id]:5},threads:{[id]:{last:'2026-10-15T12:00:00Z',people:[{key:member,name:'Ann Lee',member},{key:'bot:buddy',name:'Buddy',bot:true},{key:'g2',name:'Guest'}]}}});
});
it('falls back to counts only while the summaries function is missing, and looks again later',async()=>{
 vi.useFakeTimers();
 try{
  m.rpc.mockImplementation(async(name:string)=>name==='chat_thread_summaries'?{data:null,error:{code:'PGRST202',message:'Could not find the function public.chat_thread_summaries'}}:{data:[{message_id:id,reply_count:2}],error:null});
  expect(await (await GET(req())).json()).toEqual({counts:{[id]:2}});
  expect(m.rpc.mock.calls.map(c=>c[0])).toEqual(['chat_thread_summaries','chat_thread_counts']);
  m.rpc.mockClear();expect((await GET(req())).status).toBe(200);expect(m.rpc.mock.calls.map(c=>c[0])).toEqual(['chat_thread_counts']);
  vi.advanceTimersByTime(61_000);m.rpc.mockClear();await GET(req());expect(m.rpc.mock.calls[0][0]).toBe('chat_thread_summaries');
 }finally{vi.useRealTimers();}
});
