import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
const mock=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/lib/chatAdmin',()=>({createChatAdminClient:()=>({rpc:mock.rpc})}));
import {POST} from '@/app/api/chat/gainers/ingest/route';
import {parseGainersAlert,gainersAuthorized} from '@/lib/chatGainers';
import {allowedChatRooms,canWriteChatRoom} from '@/lib/chatAccess';
const token='x'.repeat(64),now=Date.now();
const alert={sourceChannelId:'-100123',sourceMessageId:42,postedAt:new Date(now).toISOString(),body:'MNOV stock alert'};
const request=(payload:unknown=alert,auth=`Bearer ${token}`)=>new NextRequest('http://localhost/api/chat/gainers/ingest',{method:'POST',headers:{authorization:auth,'content-type':'application/json'},body:JSON.stringify(payload)});
beforeEach(()=>{vi.stubEnv('CHAT_GAINERS_INGEST_TOKEN',token);vi.stubEnv('CHAT_GAINERS_TELEGRAM_CHANNEL_ID','-100123');vi.stubEnv('CHAT_GAINERS_START_AT',new Date(now-1000).toISOString());mock.rpc.mockReset().mockResolvedValue({data:{messageId:'message',duplicate:false},error:null});});
afterEach(()=>vi.unstubAllEnvs());
describe('Gainers source boundary',()=>{
 it('requires independent producer credential before parsing or database access',async()=>{
  for(const auth of ['', 'Bearer wrong', `Basic ${token}`])expect((await POST(request(alert,auth))).status).toBe(401);
  expect(mock.rpc).not.toHaveBeenCalled();expect(gainersAuthorized(`Bearer ${token}`,undefined)).toBe(false);
 });
 it('fails closed until source and rollout start configured',async()=>{
  vi.stubEnv('CHAT_GAINERS_START_AT','');expect((await POST(request())).status).toBe(503);expect(mock.rpc).not.toHaveBeenCalled();
 });
 it('allows faithful long Unicode stock posts and fixed RPC fields only',async()=>{
  const payload={...alert,body:'📈'.repeat(4096)};const r=await POST(request(payload));expect(r.status).toBe(200);
  expect(mock.rpc).toHaveBeenCalledWith('ingest_chat_gainers_alert',{p_channel:'-100123',p_source_id:42,p_posted_at:alert.postedAt,p_body:payload.body});
 });
 it.each([{sourceChannelId:'-999'},{sourceMessageId:1.2},{sourceMessageId:Number.MAX_SAFE_INTEGER+1},{sourceMessageId:0},{postedAt:'2020-01-01T00:00:00Z'},{postedAt:new Date(now+600000).toISOString()},{body:''},{body:'x'.repeat(4097)},{room:'main'},{author:'Admin'}])('rejects invalid/source impersonating data %j',async change=>{expect((await POST(request({...alert,...change}))).status).toBe(400);expect(mock.rpc).not.toHaveBeenCalled();});
 it('bounds streamed input independent of content length',async()=>{expect((await POST(request({...alert,body:'x'.repeat(32769)}))).status).toBe(413);expect(mock.rpc).not.toHaveBeenCalled();});
 it('returns stable duplicate response and distinguishes conflict from transient outage',async()=>{
  mock.rpc.mockResolvedValueOnce({data:{messageId:'same',duplicate:true},error:null});expect(await (await POST(request())).json()).toEqual({messageId:'same',duplicate:true});
  mock.rpc.mockResolvedValueOnce({error:{message:'gainers_source_conflict'}});expect((await POST(request())).status).toBe(409);
  mock.rpc.mockResolvedValueOnce({error:{message:'private database details'}});const r=await POST(request());expect(r.status).toBe(503);expect(await r.json()).toEqual({error:'ingest_unavailable'});
 });
 it('does not allow historical import before start',()=>{expect(parseGainersAlert(alert,'-100123',new Date(now+1).toISOString(),now)).toBeNull();});
});
it('all eligible chat members can read but no member/admin can write broadcast',()=>{
 for(const access of [{longboard:true,shortscout:false,admin:false},{longboard:false,shortscout:true,admin:false},{longboard:false,shortscout:false,shortscoutMember:true,admin:false},{longboard:true,shortscout:false,admin:true}]){
  expect(allowedChatRooms(access)).toContain('gainers');expect(canWriteChatRoom(access,'gainers')).toBe(false);
 }
 expect(allowedChatRooms({longboard:false,shortscout:false,admin:false})).not.toContain('gainers');
});
