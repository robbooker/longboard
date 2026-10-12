const pushAfter=vi.hoisted(()=>vi.fn());
vi.mock('next/server',async original=>({...await original<typeof import('next/server')>(),after:pushAfter}));
import {beforeEach,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const m=vi.hoisted(()=>({auth:vi.fn(),from:vi.fn(),parent:vi.fn(),list:vi.fn(),insert:vi.fn(),eq:vi.fn(),order:vi.fn()}));
vi.mock('@/lib/chatAuth',()=>({requireChatUser:m.auth}));
vi.mock('@/lib/chatAdmin',()=>({createChatAdminClient:()=>({from:m.from,rpc:m.insert}),requestOriginAllowed:()=>true,readPublicRoomState:async()=>({isOpen:true})}));
vi.mock('@/lib/chatMembers',()=>({CHAT_UUID:/^[0-9a-f-]{36}$/i,findChatMember:async()=>({id:'member',display_name:'Trusted'})}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({from:m.from,rpc:m.insert})}));
vi.mock('@/lib/chatBuddy',()=>({hasBuddyMention:()=>false}));
import {GET} from '@/app/api/chat/thread/route';
import {POST} from '@/app/api/chat/route';
const id='10000000-0000-4000-8000-000000000001';
const get=(room='main',message=id)=>new NextRequest(`https://example.test/api/chat/thread?room=${room}&messageId=${message}`);
const send=(replyTo:unknown,room='main')=>new NextRequest('https://example.test/api/chat',{method:'POST',body:JSON.stringify({action:'send',room,body:'Reply text',replyTo,member_id:'forged'})});
beforeEach(()=>{
 vi.clearAllMocks();vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://example.test');vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test-only');
 m.auth.mockResolvedValue({ok:true,user:{id:'account'},access:{longboard:true,boardroom:true,shortscout:false,admin:false}});
 m.parent.mockResolvedValue({data:{id,body:'Parent'},error:null});m.list.mockResolvedValue({data:[],error:null});
 m.insert.mockResolvedValue({data:{status:'sent',message:{id:'reply',body:'Reply text',memberships:[]}},error:null});
 m.from.mockImplementation(()=>{const q={select:()=>q,eq:(key:string,val:unknown)=>{m.eq(key,val);return q;},gte:()=>q,order:(...args:unknown[])=>{m.order(...args);return q;},limit:m.list,maybeSingle:m.parent,insert:m.insert};return q;});
});
it('requires auth and membership on both reads and replies',async()=>{
 expect((await GET(get('shortscout'))).status).toBe(403);expect((await POST(send(id,'shortscout'))).status).toBe(403);
 m.auth.mockResolvedValue({ok:false,status:401,error:'unauthorized'});expect((await GET(get())).status).toBe(401);expect((await POST(send(id))).status).toBe(401);expect(m.from).not.toHaveBeenCalled();
});
it('rejects malformed and deleted/cross-room parents',async()=>{
 expect((await GET(get('main','bad'))).status).toBe(400);expect((await POST(send('bad'))).status).toBe(400);
 expect(m.insert).not.toHaveBeenCalled();
 m.parent.mockResolvedValue({data:null,error:null});expect((await GET(get())).status).toBe(404);expect(m.eq).toHaveBeenCalledWith('room_slug','main');
 // The send function checks the parent (same room, not removed) in the same call as the insert.
 m.insert.mockResolvedValue({data:{status:'reply_not_found'},error:null});expect((await POST(send(id))).status).toBe(404);
});
it('only lists replies belonging to the authorized room and parent',async()=>{
 m.list.mockResolvedValue({data:[{id:'newer'},{id:'older'}],error:null});const response=await GET(get());expect(await response.json()).toEqual({parent:{id,body:'Parent',memberships:[]},replies:[{id:'older',memberships:[]},{id:'newer',memberships:[]}],hasMore:false});expect(m.order).toHaveBeenCalledWith('unread_seq',{ascending:false});expect(m.eq).toHaveBeenCalledWith('reply_to_id',id);expect(m.eq).toHaveBeenCalledWith('room_slug','main');expect(response.headers.get('cache-control')).toContain('no-store');
});
it('persists the parent and authenticated identity for replies',async()=>{
 expect((await POST(send(id))).status).toBe(200);expect(m.insert).toHaveBeenCalledWith('send_chat_room_message',{p_user:'account',p_room:'main',p_body:'Reply text',p_reply:id,p_files:[],p_client:expect.any(String)});
});
it('fails closed on lookup/database errors',async()=>{
 m.parent.mockResolvedValue({error:{message:'failure'}});expect((await GET(get())).status).toBe(503);
 m.insert.mockResolvedValue({data:null,error:{message:'failure'}});expect((await POST(send(id))).status).toBe(500);
});
