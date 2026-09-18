import {beforeEach,expect,it,vi} from 'vitest';import {NextRequest} from 'next/server';
const mocks=vi.hoisted(()=>({auth:vi.fn(),origin:vi.fn(),upsert:vi.fn()}));
vi.mock('@/lib/chatAuth',()=>({requireChatUser:mocks.auth}));vi.mock('@/lib/chatAdmin',()=>({createChatAdminClient:()=>({from:()=>({upsert:mocks.upsert})}),requestOriginAllowed:mocks.origin}));
import {POST} from '@/app/api/chat/activity/route';
const req=(body:unknown)=>new NextRequest('https://example.test/api/chat/activity',{method:'POST',body:JSON.stringify(body)});
beforeEach(()=>{vi.clearAllMocks();mocks.origin.mockReturnValue(true);mocks.auth.mockResolvedValue({ok:true,user:{id:'verified-user'}});mocks.upsert.mockResolvedValue({error:null});});
it('stores only the verified account preference, ignoring forged identity',async()=>{expect((await POST(req({kind:'preferences',replies:false,account_id:'other'}))).status).toBe(200);expect(mocks.upsert).toHaveBeenCalledWith({account_id:'verified-user',replies:false},{onConflict:'account_id'});});
it('rejects invalid settings, unauthenticated and foreign-origin requests',async()=>{expect((await POST(req({kind:'preferences',replies:'false'}))).status).toBe(400);mocks.auth.mockResolvedValue({ok:false,error:'unauthenticated',status:401});expect((await POST(req({kind:'preferences',replies:false}))).status).toBe(401);mocks.origin.mockReturnValue(false);expect((await POST(req({kind:'preferences',replies:false}))).status).toBe(403);expect(mocks.upsert).not.toHaveBeenCalled();});
it('reports persistence failures',async()=>{mocks.upsert.mockResolvedValue({error:{message:'failed'}});expect((await POST(req({kind:'preferences',replies:true}))).status).toBe(503);});
