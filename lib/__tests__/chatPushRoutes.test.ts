import {beforeEach,describe,it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
const mock=vi.hoisted(()=>({auth:vi.fn(),origin:vi.fn(),rpc:vi.fn(),from:vi.fn(),send:vi.fn()}));
vi.mock('@/lib/chatAuth',()=>({requireChatUser:mock.auth}));vi.mock('@/lib/chatAdmin',()=>({requestOriginAllowed:mock.origin,createChatAdminClient:()=>({rpc:mock.rpc,from:mock.from})}));
vi.mock('@/lib/chatPush',async importOriginal=>({...await importOriginal<object>(),sendChatPush:mock.send}));
import {GET,POST,DELETE} from '@/app/api/chat/push/route';import {POST as testPush} from '@/app/api/chat/push/test/route';
const actor='00000000-0000-4000-8000-000000000001';
const req=(body:unknown)=>new NextRequest('https://www.longboardai.com/api/chat/push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{vi.clearAllMocks();mock.origin.mockReturnValue(true);mock.auth.mockResolvedValue({ok:true,user:{id:actor}});process.env.CHAT_PUSH_PUBLIC_KEY='public';process.env.CHAT_PUSH_PRIVATE_KEY='private';process.env.CHAT_PUSH_SUBJECT='mailto:owner@example.com';});
describe('push HTTP authorization',()=>{
 it('rejects mutations from other origins before auth or DB',async()=>{mock.origin.mockReturnValue(false);expect((await POST(req({}))).status).toBe(403);expect(mock.auth).not.toHaveBeenCalled();});
 it('rejects switched accounts for all mutations before DB',async()=>{for(const handler of [POST,DELETE,testPush])expect((await handler(req({accountId:'other',endpoint:'https://web.push.apple.com/test'}))).status).toBe(409);expect(mock.rpc).not.toHaveBeenCalled();expect(mock.from).not.toHaveBeenCalled();});
 it('requires authentication for public VAPID configuration',async()=>{mock.auth.mockResolvedValue({ok:false,status:401,error:'unauthenticated'});expect((await GET(new NextRequest('https://www.longboardai.com/api/chat/push'))).status).toBe(401);});
 it('never sends a test to an unowned device or a rate-limited device',async()=>{mock.rpc.mockResolvedValue({data:null,error:null});expect((await testPush(req({accountId:actor,endpoint:'https://web.push.apple.com/test'}))).status).toBe(429);expect(mock.send).not.toHaveBeenCalled();expect(mock.rpc).toHaveBeenCalledWith('test_chat_push_subscription',{actor,p_endpoint:'https://web.push.apple.com/test'});});
 it('deletes only the authenticated account endpoint',async()=>{const eq=vi.fn();eq.mockReturnValue({eq});eq.mockImplementationOnce(()=>({eq}));eq.mockImplementationOnce(()=>Promise.resolve({error:null}));mock.from.mockReturnValue({delete:()=>({eq})});expect((await DELETE(req({accountId:actor,endpoint:'https://web.push.apple.com/test'}))).status).toBe(200);expect(eq.mock.calls).toEqual([['account_id',actor],['endpoint','https://web.push.apple.com/test']]);});
});
