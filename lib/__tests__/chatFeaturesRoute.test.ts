import {beforeEach,describe,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const mocks=vi.hoisted(()=>({access:vi.fn(),rpc:vi.fn(),ai:vi.fn(),from:vi.fn()}));
vi.mock('@/lib/chatFeatures',()=>({featureAccess:mocks.access}));
vi.mock('@/lib/chatOpenAI',()=>({runNanoChat:mocks.ai}));
import {POST,GET} from '@/app/api/chat/features/route';
const req=(body:unknown)=>new NextRequest('https://example.test/api/chat/features',{method:'POST',headers:{origin:'https://example.test',host:'example.test','Content-Type':'application/json'},body:JSON.stringify(body)});
const id='00000000-0000-4000-8000-000000000001';
describe('private feature API',()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.access.mockResolvedValue({user:{id},role:'participant',db:{rpc:mocks.rpc,from:mocks.from}});mocks.rpc.mockResolvedValue({data:id,error:null});});
 it('hides all data from outsiders',async()=>{mocks.access.mockResolvedValue(null);expect((await GET(new NextRequest('https://example.test/api/chat/features'))).status).toBe(404);expect((await POST(req({action:'create',content:'idea'}))).status).toBe(404);expect(mocks.rpc).not.toHaveBeenCalled();});
 it('keeps the lightweight status feed private',async()=>{
  mocks.access.mockResolvedValue(null);
  expect((await GET(new NextRequest('https://example.test/api/chat/features?statusOnly=1'))).status).toBe(404);
  expect(mocks.from).not.toHaveBeenCalled();
 });
 it('returns only status fields without fetching discussions',async()=>{
  const select=vi.fn(()=>({order:()=>({limit:async()=>({data:[{id,status:'in_progress'}],error:null})})}));
  mocks.from.mockReturnValue({select});
  const response=await GET(new NextRequest('https://example.test/api/chat/features?statusOnly=1'));
  expect(await response.json()).toEqual({statuses:[{id,status:'in_progress'}]});
  expect(select).toHaveBeenCalledWith('id,status');expect(mocks.from).toHaveBeenCalledTimes(1);
 });
 it('rejects invalid bodies without mutating',async()=>{for(const body of [null,[],{}, {action:'message',id,content:''}])expect((await POST(req(body))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();});
 it('derives actor from verified session',async()=>{expect((await POST(req({action:'create',content:'idea',actor:'attacker',role:'owner'}))).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('chat_feature_action',expect.objectContaining({actor:id}));});
 it('does not generate a reply when approval or message fails',async()=>{mocks.rpc.mockResolvedValue({error:{message:'owner_only'}});expect((await POST(req({action:'approve',id,revision:2}))).status).toBe(409);expect(mocks.ai).not.toHaveBeenCalled();});
 it('replies to mentions using the thread and saves assistant attribution',async()=>{
  const insert=vi.fn().mockResolvedValue({error:null});
  mocks.from.mockImplementation((table:string)=>table==='chat_feature_requests'?{select:()=>({eq:()=>({single:async()=>({data:{title:'idea'},error:null})})})}:{select:()=>({eq:()=>({order:()=>({limit:async()=>({data:[{author_label:'Jammie',body:'@Codex help'}],error:null})})})}),insert});
  mocks.ai.mockResolvedValue('Proposed scope: pin messages.');
  const response=await POST(req({action:'message',id,content:'@Codex help'}));
  expect(await response.json()).toEqual({id,assistantError:false});expect(insert).toHaveBeenCalledWith(expect.objectContaining({request_id:id,kind:'assistant',body:'Proposed scope: pin messages.'}));
 });
 it('reports AI failure while preserving the human message',async()=>{mocks.from.mockImplementation(()=>{throw Error('provider unavailable');});expect(await (await POST(req({action:'message',id,content:'@Codex help'}))).json()).toEqual({id,assistantError:true});expect(mocks.rpc).toHaveBeenCalledTimes(1);});
});
