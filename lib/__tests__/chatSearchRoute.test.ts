import {beforeEach,describe,it,expect,vi} from "vitest";
import {NextRequest} from "next/server";
const mock=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn(),budget:vi.fn(),embed:vi.fn()}));
vi.mock("@/lib/chatAuth",()=>({requireChatUser:mock.auth}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({rpc:mock.rpc})}));
vi.mock("@/lib/chatAdmin",()=>({createChatAdminClient:()=>({rpc:(name:string,args:unknown)=>name==="take_longboard_chat_search_budget"?mock.budget(name,args):mock.rpc(name,args)})}));
vi.mock("@/lib/chatEmbeddings",()=>({embedChatText:mock.embed}));
import {GET} from "@/app/api/chat/search/route";
import {GET as context} from "@/app/api/chat/search/context/route";
const req=(query:string)=>new NextRequest(`https://longboard.test/api/chat/search?${query}`);
beforeEach(()=>{vi.clearAllMocks();mock.auth.mockResolvedValue({ok:true,access:{longboard:true,boardroom:true,shortscout:false,admin:false},user:{id:"member"}});mock.rpc.mockResolvedValue({data:[],error:null});mock.budget.mockResolvedValue({data:true,error:null});mock.embed.mockResolvedValue({vectors:[[1,2]],tokens:2});});
describe("member chat search",()=>{
 it("restricts SS-only all-room search to SOCIAL and rejects LB",async()=>{
  mock.auth.mockResolvedValue({ok:true,user:{id:"scout"},access:{longboard:false,shortscout:true,admin:false}});
  expect((await GET(req("q=hello&room=main"))).status).toBe(403);
  expect(mock.rpc).not.toHaveBeenCalled();
  expect((await GET(req("q=hello&room=all"))).status).toBe(200);
  expect(mock.rpc).toHaveBeenCalledWith("search_longboard_chat",expect.objectContaining({p_room:"social"}));
 });
 it("uses caller permissions for semantic retrieval after a paid-query budget check",async()=>{
  expect((await GET(req("q=taking+profits&mode=meaning&room=social"))).status).toBe(200);
  expect(mock.budget).toHaveBeenCalledWith("take_longboard_chat_search_budget",{p_user:"member"});
  expect(mock.rpc).toHaveBeenCalledWith("search_longboard_chat_semantic",{p_query:"taking profits",p_embedding:"[1,2]",p_room:"social"});
 });
 it("does not spend on embeddings when the member is rate limited",async()=>{
  mock.budget.mockResolvedValue({data:false,error:null});
  expect((await GET(req("q=hello&mode=meaning"))).status).toBe(429);expect(mock.embed).not.toHaveBeenCalled();
 });
 it("keeps keyword search available when the embedding provider is down",async()=>{
  mock.embed.mockRejectedValue(new Error("private provider error"));
  const r=await GET(req("q=hello&mode=meaning"));expect(r.status).toBe(503);expect(await r.text()).not.toContain("private");
  expect((await GET(req("q=hello&mode=keywords"))).status).toBe(200);
 });
 it("blocks anonymous search and context before querying",async()=>{mock.auth.mockResolvedValue({ok:false,status:401,error:"unauthenticated"});expect((await GET(req("q=hello"))).status).toBe(401);expect((await context(req("id=bad"))).status).toBe(401);expect(mock.rpc).not.toHaveBeenCalled();});
 it("rejects missing profiles",async()=>{mock.auth.mockResolvedValue({ok:false,status:403,error:"no_profile"});expect((await GET(req("q=hello"))).status).toBe(403);});
 it("validates scope, length and pagination",async()=>{for(const q of ["q=a","q=hello&room=private","q=hello&before=bad","q=hello&beforeId=bad"])expect((await GET(req(q))).status).toBe(400);expect(mock.rpc).not.toHaveBeenCalled();});
 it("bounds results and reports another page",async()=>{mock.rpc.mockResolvedValue({data:Array.from({length:21},(_,i)=>({id:String(i)})),error:null});const r=await GET(req("q=AAPL&room=all"));const data=await r.json();expect(data.messages).toHaveLength(20);expect(data.hasMore).toBe(true);expect(r.headers.get("Cache-Control")).toBe("no-store");expect(mock.rpc).toHaveBeenCalledWith("search_longboard_chat",{p_query:"AAPL",p_room:"all",p_before:null,p_before_id:null});});
 it("does not expose database errors",async()=>{mock.rpc.mockResolvedValue({data:null,error:{message:"sensitive diagnostic"}});const r=await GET(req("q=hello"));expect(r.status).toBe(503);expect(await r.text()).not.toContain("sensitive");});
});

describe('SS and explicit combination authorization',()=>{
 const cohorts={lb:{longboard:true,boardroom:true,shortscout:false,admin:false},basic:{longboard:true,boardroom:false,shortscout:false,admin:false},ss:{longboard:false,shortscout:true,admin:false},paid:{longboard:false,shortscout:false,shortscoutMember:true,admin:false},both:{longboard:true,boardroom:true,shortscout:true,admin:false},admin:{longboard:true,shortscout:false,admin:true}};
 const allowed={lb:['main','social','lb-social'],basic:['social'],ss:['shortscout','social','ss-social'],paid:['social'],both:['main','shortscout','social','lb-social','ss-social'],admin:['main','shortscout','social','lb-social','ss-social']};
 for(const [name,access] of Object.entries(cohorts))for(const mode of ['keywords','meaning'])it(`${name} ${mode} checks every selected room before spending or reading`,async()=>{
  for(const scope of ['main','shortscout','social','lb-social','ss-social']){
   vi.clearAllMocks();mock.auth.mockResolvedValue({ok:true,user:{id:'member'},access});
   const expected=allowed[name as keyof typeof allowed].includes(scope);expect((await GET(req(`q=needle&mode=${mode}&room=${scope}`))).status).toBe(expected?200:403);
   if(expected)expect(mock.rpc).toHaveBeenCalledWith(mode==='keywords'?'search_longboard_chat':'search_longboard_chat_semantic',expect.objectContaining({p_room:scope}));
   else{expect(mock.rpc).not.toHaveBeenCalled();expect(mock.budget).not.toHaveBeenCalled();expect(mock.embed).not.toHaveBeenCalled();}
  }
 });
 it('keeps legacy all limited to LB/SOCIAL even for a dual member',async()=>{mock.auth.mockResolvedValue({ok:true,user:{id:'member'},access:cohorts.both});await GET(req('q=needle&room=all'));expect(mock.rpc).toHaveBeenCalledWith('search_longboard_chat',expect.objectContaining({p_room:'all'}));});
 it('preserves the exact pair on a keyword next page and forbids semantic cursors',async()=>{
  mock.auth.mockResolvedValue({ok:true,user:{id:'member'},access:cohorts.ss});const cursor='before=2026-10-01T12:00:00Z&beforeId=10000000-0000-4000-8000-000000000001';
  expect((await GET(req('q=needle&room=ss-social&'+cursor))).status).toBe(200);expect(mock.rpc).toHaveBeenCalledWith('search_longboard_chat',expect.objectContaining({p_room:'ss-social',p_before:'2026-10-01T12:00:00Z'}));
  mock.budget.mockClear();expect((await GET(req('q=needle&room=ss-social&mode=meaning&'+cursor))).status).toBe(400);expect(mock.budget).not.toHaveBeenCalled();
 });
 it('revoked SS cannot request stale SS results or bypass using a combination',async()=>{mock.auth.mockResolvedValue({ok:true,user:{id:'member'},access:cohorts.paid});for(const room of ['shortscout','ss-social'])expect((await GET(req(`q=needle&mode=meaning&room=${room}`))).status).toBe(403);expect(mock.embed).not.toHaveBeenCalled();});
});
