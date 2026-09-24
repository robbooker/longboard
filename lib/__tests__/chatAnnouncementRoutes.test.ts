import {beforeEach,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {POST as post} from '@/app/api/chat/route';
import {POST as change} from '@/app/api/chat/message/route';
import {attachmentAccess} from '@/lib/chatAttachments';
const mocks=vi.hoisted(()=>({auth:vi.fn(),member:vi.fn(),from:vi.fn(),upsert:vi.fn()}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({from:mocks.from})}));
vi.mock('@/lib/chatAdmin',async importOriginal=>({...await importOriginal<typeof import('@/lib/chatAdmin')>(),readPublicRoomState:async()=>({isOpen:true})}));
vi.mock('@/lib/chatAuth',()=>({requireChatUser:mocks.auth}));
vi.mock('@/lib/chatMembers',()=>({findChatMember:mocks.member,CHAT_UUID:/^[a-f\d-]{36}$/i}));
const auth={ok:true as const,user:{id:'00000000-0000-4000-8000-000000000001',email:'member@example.test',role:'user' as const},access:{longboard:true,boardroom:true,shortscout:false,admin:false},serverSession:false};
beforeEach(()=>{vi.clearAllMocks();const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{id:'target'},error:null}),upsert:(body:unknown)=>{mocks.upsert(body);return q;},single:async()=>({data:{active:true},error:null})};mocks.from.mockReturnValue(q);mocks.auth.mockResolvedValue(auth);mocks.member.mockResolvedValue({id:'member'});vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://example.supabase.co');vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test-only');});
const request=(path:string,body:object)=>new NextRequest(`https://example.test${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
it.each(['send'])('rejects member %s before database writes',async action=>{expect((await post(request('/api/chat',{room:'lb-announcements',action,body:'no'}))).status).toBe(403);});
it.each(['edit','delete'])('rejects member announcement %s',async action=>{expect((await change(request('/api/chat/message',{room:'lb-announcements',action,messageId:'00000000-0000-4000-8000-000000000002'}))).status).toBe(403);});
it('denies announcement attachment writes while preserving member reads',async()=>{await expect(attachmentAccess({} as never,auth,{room_slug:'lb-announcements'},true)).rejects.toMatchObject({status:403});await expect(attachmentAccess({} as never,auth,{room_slug:'lb-announcements'})).resolves.toEqual({id:'member'});});

it('allows an entitled member to react to an announcement using their verified identity',async()=>{
 const messageId='00000000-0000-4000-8000-000000000002';
 expect((await post(request('/api/chat',{room:'lb-announcements',action:'react',messageId,active:true,guestId:'forged'}))).status).toBe(200);
 expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({message_id:messageId,guest_id:'member',active:true}));
});

it.each([false,true])('Gainers rejects posts, replies, edits and uploads even for admin=%s',async admin=>{
 const gainsAuth={...auth,user:{...auth.user,role:admin?'admin':'user'},access:{...auth.access,admin}};
 mocks.auth.mockResolvedValue(gainsAuth);
 for(const replyTo of [undefined,'00000000-0000-4000-8000-000000000002'])expect((await post(request('/api/chat',{room:'gainers',action:'send',body:'cannot post',replyTo}))).status).toBe(403);
 for(const action of ['edit','delete'])expect((await change(request('/api/chat/message',{room:'gainers',action,messageId:'00000000-0000-4000-8000-000000000002'}))).status).toBe(403);
 await expect(attachmentAccess({} as never,gainsAuth as typeof auth,{room_slug:'gainers'},true)).rejects.toMatchObject({status:403});
 expect(mocks.upsert).not.toHaveBeenCalled();expect(mocks.from).not.toHaveBeenCalled();
});

it.each(['lb-recordings','ss-recordings'])('recording controls reject member writes and all admin replies in %s', async room=>{
 const entitled={...auth,access:{...auth.access,shortscout:true}};
 mocks.auth.mockResolvedValue(entitled);
 expect((await post(request('/api/chat',{room,action:'send',body:'recording'}))).status).toBe(403);
 for(const action of ['edit','delete'])expect((await change(request('/api/chat/message',{room,action,messageId:'00000000-0000-4000-8000-000000000002'}))).status).toBe(403);
 await expect(attachmentAccess({} as never,entitled,{room_slug:room},true)).rejects.toMatchObject({status:403});
 await expect(attachmentAccess({} as never,entitled,{room_slug:room})).resolves.toEqual({id:'member'});
 mocks.auth.mockResolvedValue({...entitled,user:{...auth.user,role:'admin'},access:{...entitled.access,admin:true}});
 expect((await post(request('/api/chat',{room,action:'send',body:'reply',replyTo:'00000000-0000-4000-8000-000000000002'}))).status).toBe(403);
 expect(mocks.from).not.toHaveBeenCalled();
});
