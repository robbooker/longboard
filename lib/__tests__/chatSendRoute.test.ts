const m=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn(),from:vi.fn(),after:vi.fn(),publish:vi.fn()}));
vi.mock('next/server',async original=>({...await original<typeof import('next/server')>(),after:m.after}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({from:m.from,rpc:m.rpc})}));
vi.mock('@/lib/chatAdmin',()=>({requestOriginAllowed:()=>true,readPublicRoomState:async()=>({isOpen:true})}));
vi.mock('@/lib/chatAuth',()=>({requireChatUser:m.auth}));
vi.mock('@/lib/chatRealtimePublish',()=>({publishRoomEventAfterResponse:m.publish}));
import {beforeEach,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {POST} from '@/app/api/chat/route';
const clientId='00000000-0000-4000-8000-000000000002';
const message={id:'00000000-0000-4000-8000-000000000003',body:'Hello',author_label:'Member',buddy_status:null,memberships:['LB']};
const request=(extra:object={})=>new NextRequest('https://example.test/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'send',room:'main',body:'Hello',clientId,...extra})});
const result=(data:unknown)=>m.rpc.mockResolvedValue({data,error:null});
beforeEach(()=>{
 vi.clearAllMocks();vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://example.supabase.co');vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test-only');
 m.auth.mockResolvedValue({ok:true,user:{id:'account',role:'user'},access:{longboard:true,boardroom:true,shortscout:false,admin:false}});
 result({status:'sent',message});
});
it('sends in one database call and returns the message with its badges',async()=>{
 const response=await POST(request());
 expect(response.status).toBe(200);expect(await response.json()).toEqual({message});
 expect(m.rpc).toHaveBeenCalledTimes(1);expect(m.from).not.toHaveBeenCalled();
 expect(m.rpc).toHaveBeenCalledWith('send_chat_room_message',{p_user:'account',p_room:'main',p_body:'Hello',p_reply:null,p_files:[],p_client:clientId});
 expect(response.headers.get('server-timing')).toMatch(/send;dur=/);
 // Live subscribers get the stored row; badges stay a reader concern.
 const {memberships:_badges,...row}=message;
 expect(m.publish).toHaveBeenCalledWith('main',{kind:'message',eventType:'INSERT',row});
});
it('a retried send returns the stored message without queueing work again',async()=>{
 result({status:'duplicate',message});
 const response=await POST(request());
 expect(response.status).toBe(200);expect(await response.json()).toEqual({message});
 expect(m.after).not.toHaveBeenCalled();expect(m.publish).not.toHaveBeenCalled();
});
it('queues Buddy only when the insert marked it pending',async()=>{
 result({status:'sent',message:{...message,buddy_status:'pending'}});
 await POST(request());
 expect(m.after).toHaveBeenCalledTimes(2);
});
it.each([
 [{status:'paused',room:{isOpen:false,notice:'Back soon'}},423,{error:'chat_paused',room:{isOpen:false,notice:'Back soon'}}],
 [{status:'room_unavailable'},503,{error:'chat_status_unavailable'}],
 [{status:'member_required'},409,{error:'member_required',message:'Choose your member chat name first.'}],
 [{status:'send_conflict'},409,{error:'send_conflict'}],
 [{status:'reply_not_found'},404,{error:'reply_not_found'}],
 [{status:'rate_limited',reason:'window'},429,{error:'rate_limited',message:'Please pause before sending more messages.'}],
 [{status:'rate_limited',reason:'burst'},429,{error:'rate_limited',message:'Please wait a moment before sending again.'}],
])('keeps today\'s answer for %o',async(data,status,body)=>{
 result(data);
 const response=await POST(request());
 expect(response.status).toBe(status);expect(await response.json()).toEqual(body);
 expect(m.publish).not.toHaveBeenCalled();expect(m.after).not.toHaveBeenCalled();
});
it('maps database errors',async()=>{
 m.rpc.mockResolvedValue({data:null,error:{message:'attachment_not_ready'}});
 expect((await POST(request())).status).toBe(409);
 m.rpc.mockResolvedValue({data:null,error:{message:'connection reset'}});
 const response=await POST(request());
 expect(response.status).toBe(500);expect(await response.json()).toEqual({error:'message_send_failed'});
});
it.each([
 [{body:''},'invalid_message'],
 [{body:'x'.repeat(601)},'invalid_message'],
 [{clientId:'nope'},'invalid_client_id'],
 [{replyTo:'nope'},'invalid_reply'],
 [{attachmentIds:'nope'},'invalid_attachments'],
])('rejects a malformed send %o before calling the database',async(extra,error)=>{
 const response=await POST(request(extra));
 expect(response.status).toBe(400);expect(await response.json()).toEqual({error});
 expect(m.rpc).not.toHaveBeenCalled();
});
it('makes up a clientId when an older page sends none',async()=>{
 await POST(request({clientId:undefined}));
 expect(m.rpc.mock.calls[0][1].p_client).toMatch(/^[0-9a-f-]{36}$/);
});
