import {describe,it,expect,vi,beforeEach} from 'vitest';
const {auth,inbox}=vi.hoisted(()=>({auth:vi.fn(),inbox:vi.fn()}));
vi.mock('@/lib/chatAuth',()=>({requireChatUser:auth}));
vi.mock('@/lib/chatReads/inbox',()=>({readInbox:inbox}));
import {GET} from '@/app/api/chat/quad-options/route';
describe('quad options authenticated scope',()=>{
 beforeEach(()=>vi.resetAllMocks());
 it('rejects signed-out callers without reading conversations',async()=>{auth.mockResolvedValue({ok:false,status:401,error:'unauthorized'});expect((await GET()).status).toBe(401);expect(inbox).not.toHaveBeenCalled();});
 it('uses authoritative memberships and the existing participant-scoped reader',async()=>{const identity={ok:true,user:{id:'ss-user'},access:{longboard:false,shortscout:true,admin:false}};auth.mockResolvedValue(identity);inbox.mockResolvedValue(Response.json({conversations:[{id:'authorized-dm'}]}));const response=await GET();expect(response.headers.get('cache-control')).toBe('private, no-store');expect(await response.json()).toEqual({accountId:'ss-user',rooms:['social','shortscout','ss-announcements','gainers','ss-recordings'],conversations:[{id:'authorized-dm'}]});expect(inbox.mock.calls[0][1]).toBe(identity);});
 it('does not return incomplete options if the inbox authorization reader fails',async()=>{auth.mockResolvedValue({ok:true,user:{id:'x'},access:{}});inbox.mockResolvedValue(Response.json({error:'unavailable'},{status:503}));expect((await GET()).status).toBe(503);});
});
