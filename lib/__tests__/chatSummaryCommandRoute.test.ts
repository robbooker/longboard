import { beforeEach,expect,it,vi } from 'vitest';
import { NextRequest } from 'next/server';
const mock=vi.hoisted(()=>({auth:vi.fn(),member:vi.fn(),deliver:vi.fn(),db:vi.fn()}));
vi.mock('@/lib/chatAuth',()=>({requireChatUser:mock.auth}));
vi.mock('@/lib/chatMembers',()=>({CHAT_UUID:/^[0-9a-f-]{36}$/,findChatMember:mock.member}));
vi.mock('@/lib/chatAdmin',()=>({createChatAdminClient:mock.db,requestOriginAllowed:(r:NextRequest)=>r.headers.get('origin')==='https://example.test'}));
vi.mock('@/lib/chatRoomSummary',()=>({deliverRoomSummary:mock.deliver,SummaryError:class extends Error{status=503;}}));
import { POST } from '@/app/api/chat/summary/route';
const id='00000000-0000-4000-8000-000000000001';
const req=(room='main',origin='https://example.test')=>new NextRequest('https://example.test/api/chat/summary',{method:'POST',headers:{origin},body:JSON.stringify({room,clientId:id,actor:'spoofed'})});
beforeEach(()=>{vi.clearAllMocks();mock.auth.mockResolvedValue({ok:true,user:{id:'verified'},access:{longboard:true,shortscout:false,admin:false}});mock.db.mockReturnValue({});mock.member.mockResolvedValue({id});mock.deliver.mockResolvedValue({id});});
it('rejects unauthenticated, cross-origin and forbidden-room requests before any summary lookup',async()=>{
 expect((await POST(req('main','https://evil.test'))).status).toBe(403);
 expect((await POST(req('shortscout'))).status).toBe(403);
 mock.auth.mockResolvedValue({ok:false,status:401,error:'unauthorized'});expect((await POST(req())).status).toBe(401);
 expect(mock.deliver).not.toHaveBeenCalled();expect(mock.db).not.toHaveBeenCalled();
});
it('requires a valid room and member identity',async()=>{
 expect((await POST(req('private'))).status).toBe(400);
 mock.member.mockResolvedValue(null);expect((await POST(req())).status).toBe(409);expect(mock.deliver).not.toHaveBeenCalled();
});
it('ignores supplied account and returns a private no-store response',async()=>{
 const response=await POST(req());expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');
 expect(mock.deliver).toHaveBeenCalledWith({},'verified','main',id);
});
