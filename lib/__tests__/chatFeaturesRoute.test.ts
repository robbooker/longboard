import {beforeEach,describe,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const mocks=vi.hoisted(()=>({access:vi.fn(),rpc:vi.fn(),ai:vi.fn(),from:vi.fn()}));
vi.mock('@/lib/chatFeatures',()=>({featureAccess:mocks.access}));
vi.mock('@/lib/chatOpenAI',()=>({runNanoChat:mocks.ai}));
import {POST,GET} from '@/app/api/chat/features/route';
const req=(body:unknown)=>new NextRequest('https://example.test/api/chat/features',{method:'POST',headers:{origin:'https://example.test',host:'example.test','Content-Type':'application/json'},body:JSON.stringify(body)});
const id='00000000-0000-4000-8000-000000000001';
describe('private feature API',()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.access.mockResolvedValue({user:{id},role:'participant',canApproveDevelopment:true,db:{rpc:mocks.rpc,from:mocks.from}});mocks.rpc.mockResolvedValue({data:id,error:null});});
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
 it('lets only the verified development approver approve, ignoring client authority',async()=>{
  expect((await POST(req({action:'approve',id,revision:2,actor:'forged',role:'owner'}))).status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('chat_feature_action',{actor:id,request_id:id,action:'approve',content:'',expected_revision:2});
  mocks.rpc.mockClear();mocks.access.mockResolvedValue({user:{id},role:'participant',canApproveDevelopment:false,db:{rpc:mocks.rpc}});
  expect((await POST(req({action:'approve',id,revision:2,canApproveDevelopment:true}))).status).toBe(403);
  expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('keeps decline owner-only for development approvers',async()=>{
  expect((await POST(req({action:'decline',id,revision:2}))).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();
 });
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

describe('archive completion ordering',()=>{
 const calls:Array<[string,...unknown[]]>=[];
 let selected:Record<string,unknown>|null=null;
 beforeEach(()=>{
  vi.clearAllMocks();calls.length=0;selected=null;
  mocks.access.mockResolvedValue({user:{id},role:'participant',canApproveDevelopment:true,db:{rpc:mocks.rpc,from:mocks.from}});
  mocks.from.mockImplementation((table:string)=>{
   calls.push(['from',table]);const query:Record<string,unknown>={};
   for(const method of ['select','eq','neq','in','ilike','order'])query[method]=(...args:unknown[])=>{calls.push([method,...args]);return query;};
   query.maybeSingle=async()=>({data:selected,error:null});
   query.range=async(...args:unknown[])=>{calls.push(['range',...args]);return {data:Array.from({length:51},(_,i)=>({id:String(i),status:'done'})),error:null};};
   query.limit=async()=>({data:[],error:null});return query;
  });
 });
 it.each(['asc','desc'])('orders all archive rows by date %s and stable id before paginating',async(order)=>{
  const response=await GET(new NextRequest(`https://example.test/api/chat/features?view=archive&order=${order}&page=2&q=Literal%25_name`));
  const body=await response.json();expect(body.requests).toHaveLength(50);expect(body.hasMore).toBe(true);expect(body.order).toBe(order);
  expect(calls.filter(c=>c[0]==='order')).toEqual([['order','archive_order_at',{ascending:order==='asc',nullsFirst:false}],['order','id',{ascending:true}]]);
  expect(calls.at(-1)).toEqual(['range',100,150]);expect(calls).toContainEqual(['ilike','title','%Literal\\%\\_name%']);
  expect(calls).toContainEqual(['from','chat_feature_request_list']);expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('defaults to newest and rejects unsupported directions',async()=>{
  expect((await (await GET(new NextRequest('https://example.test/api/chat/features?view=archive'))).json()).order).toBe('desc');
  for(const order of ['priority','descending','asc,priority'])expect((await GET(new NextRequest('https://example.test/api/chat/features?order='+order))).status).toBe(400);
 });
 it('preserves active priority ordering even when an archive direction is retained',async()=>{
  await GET(new NextRequest('https://example.test/api/chat/features?view=active&order=asc'));
  expect(calls.filter(c=>c[0]==='order')).toEqual([['order','priority',{ascending:true}],['order','priority_set_at',{ascending:false}],['order','created_at',{ascending:true}],['order','id',{ascending:true}]]);
 });
 it('loads an archived deep link independently of a filtered page and keeps its direction',async()=>{
  selected={id,status:'done',title:'Outside search',archive_order_at:null};
  const body=await (await GET(new NextRequest(`https://example.test/api/chat/features?id=${id}&view=active&order=asc&q=Other&page=2`))).json();
  expect(body.selected).toEqual(selected);expect(body.view).toBe('archive');expect(body.order).toBe('asc');
  expect(calls).toContainEqual(['eq','id',id]);expect(calls).toContainEqual(['eq','request_id',id]);
 });
 it('keeps selected-ticket status polling on base id/status fields without an archive aggregate',async()=>{
  selected={id,status:'done'};
  const body=await (await GET(new NextRequest(`https://example.test/api/chat/features?statusOnly=1&id=${id}&view=archive&order=asc`))).json();
  expect(body.statuses).toEqual([{id,status:'done'}]);expect(calls.filter(c=>c[0]==='from')).toEqual([['from','chat_feature_requests'],['from','chat_feature_requests']]);
  expect(calls.filter(c=>c[0]==='select')).toEqual([['select','id,status'],['select','id,status']]);
 });
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
