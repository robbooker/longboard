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
  const query={neq:vi.fn(()=>query),order:vi.fn(()=>query),limit:async()=>({data:[{id,status:'in_progress'}],error:null})};
  const select=vi.fn(()=>query);
  mocks.from.mockReturnValue({select});
  const response=await GET(new NextRequest('https://example.test/api/chat/features?statusOnly=1'));
  expect(await response.json()).toEqual({statuses:[{id,status:'in_progress'}],view:'active'});
  expect(select).toHaveBeenCalledWith('id,status');expect(mocks.from).toHaveBeenCalledTimes(1);
 });
 it('rejects invalid bodies without mutating',async()=>{for(const body of [null,[],{}, {action:'message',id,content:''}])expect((await POST(req(body))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();});
 it('derives actor from verified session',async()=>{expect((await POST(req({action:'create',content:'idea',actor:'attacker',role:'owner'}))).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('create_chat_feature',{actor:id,title:'idea',priority:2});});
 it('does not generate a reply when approval or message fails',async()=>{mocks.rpc.mockResolvedValue({error:{message:'owner_only'}});expect((await POST(req({action:'approve',id,revision:2}))).status).toBe(409);expect(mocks.ai).not.toHaveBeenCalled();});
 it.each(['@Codex help','Can we pin useful messages?'])('replies to discussion messages with or without a tag: %s',async(content)=>{
  const insert=vi.fn().mockResolvedValue({error:null});
  mocks.from.mockImplementation((table:string)=>table==='chat_feature_requests'?{select:()=>({eq:()=>({single:async()=>({data:{title:'idea'},error:null})})})}:{select:()=>({eq:()=>({order:()=>({limit:async()=>({data:[{author_label:'Jammie',body:'@Codex help'}],error:null})})})}),insert});
  mocks.ai.mockResolvedValue('Proposed scope: pin messages.');
  const response=await POST(req({action:'message',id,content}));
  expect(await response.json()).toEqual({id,assistantError:false});expect(insert).toHaveBeenCalledWith(expect.objectContaining({request_id:id,kind:'assistant',body:'Proposed scope: pin messages.'}));expect(mocks.ai).toHaveBeenCalledTimes(1);
 });
 it('reports AI failure while preserving the human message',async()=>{mocks.from.mockImplementation(()=>{throw Error('provider unavailable');});expect(await (await POST(req({action:'message',id,content:'@Codex help'}))).json()).toEqual({id,assistantError:true});expect(mocks.rpc).toHaveBeenCalledTimes(1);});
});

describe('publishing approval API',()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.access.mockResolvedValue({user:{id},role:'owner',db:{rpc:mocks.rpc,from:mocks.from}});mocks.rpc.mockResolvedValue({data:id,error:null});});
 const approval={action:'approve_release',id,confirmed:true,releaseVersion:2,headSha:'a'.repeat(40)};
 it('requires the authenticated owner, ignoring forged actor and role',async()=>{
  mocks.access.mockResolvedValue({user:{id},role:'participant',db:{rpc:mocks.rpc}});
  expect((await POST(req({...approval,actor:'owner',role:'owner'}))).status).toBe(403);
  expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('requires explicit confirmation and a specific valid version',async()=>{
  for(const change of [{confirmed:false},{confirmed:undefined},{releaseVersion:0},{releaseVersion:1.5},{headSha:'bad'}])expect((await POST(req({...approval,...change}))).status).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('records approval without calling merge, deployment or completion',async()=>{
  expect((await POST(req({...approval,actor:'attacker'}))).status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('approve_chat_feature_release',{actor:id,feature:id,expected_version:2,expected_sha:'a'.repeat(40)});
 });
 it('rejects stale approvals and the former browser completion action',async()=>{
  mocks.rpc.mockResolvedValue({error:{message:'release_changed_or_locked'}});
  expect((await POST(req(approval))).status).toBe(409);
  expect((await POST(req({action:'published',id}))).status).toBe(400);
 });
 it('blocks cross-origin approval',async()=>{
  const response=await POST(new NextRequest('https://example.test/api/chat/features',{method:'POST',headers:{origin:'https://attacker.test',host:'example.test'},body:JSON.stringify(approval)}));
  expect(response.status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();
 });
});
