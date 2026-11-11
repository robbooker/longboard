import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks=vi.hoisted(()=>({auth:vi.fn(),member:vi.fn(),from:vi.fn(),select:vi.fn(),ilike:vi.fn(),limit:vi.fn(),rpc:vi.fn()}));
vi.mock("@/lib/chatAuth",()=>({requireChatUser:mocks.auth}));
vi.mock("@/lib/chatMembers",()=>({CHAT_UUID:/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,findChatMember:mocks.member,withAvatarColumn:(read:(avatar:boolean)=>unknown)=>read(true)}));
vi.mock("@/lib/chatAdmin",()=>({createChatAdminClient:()=>({from:mocks.from,rpc:mocks.rpc})}));
import { GET } from "@/app/api/chat/mentions/route";
const req=(q="")=>new NextRequest(`https://longboard.test/api/chat/mentions?q=${encodeURIComponent(q)}`);
// The tests above #439's are the list before its migration (the database function is missing).
beforeEach(()=>{
 vi.clearAllMocks();mocks.rpc.mockResolvedValue({data:null,error:{code:"PGRST202",message:"Could not find the function public.chat_tag_suggestions"}}); mocks.auth.mockResolvedValue({ok:true,access:{longboard:true,shortscout:false,admin:false},user:{id:"account"}});mocks.member.mockResolvedValue({id:"member"});
 mocks.from.mockReturnValue({select:mocks.select});mocks.select.mockReturnValue({ilike:mocks.ilike});mocks.ilike.mockReturnValue({order:()=>({limit:mocks.limit})});mocks.limit.mockResolvedValue({data:[{id:"other",display_name:"Rob"}],error:null});
});
it("requires a signed-in linked member",async()=>{
 mocks.auth.mockResolvedValue({ok:false,status:401,error:"unauthorized"});expect((await GET(req())).status).toBe(401);expect(mocks.from).not.toHaveBeenCalled();
 mocks.auth.mockResolvedValue({ok:true,access:{longboard:true,shortscout:false,admin:false},user:{id:"account"}});mocks.member.mockResolvedValue(null);expect((await GET(req())).status).toBe(403);
});
it("only selects public member identities and bounds the response",async()=>{
 expect((await GET(req("Rob"))).status).toBe(200);expect(mocks.select).toHaveBeenCalledWith("id, display_name, avatar_path");expect(mocks.limit).toHaveBeenCalledWith(10);
});
it("rejects wildcard input and escapes literal underscores",async()=>{
 expect((await GET(req("%"))).status).toBe(400);await GET(req("Rob_"));expect(mocks.ilike).toHaveBeenCalledWith("display_name","Rob\\_%");
});
it.each(["O'Neill",'O’Neill','O‘Neill'])('looks up literal apostrophes in %s',async name=>{
 expect((await GET(req(name))).status).toBe(200);expect(mocks.ilike).toHaveBeenCalledWith('display_name',name+'%');
});
// #439: the list comes from the database, one row per member, with the earlier name a member was found by.
it("asks for one row per member and passes the earlier name on",async()=>{
 mocks.rpc.mockResolvedValue({data:[{id:"b",display_name:"Robert Bobson",avatar_path:null,previous_name:"Bob"},{id:"c",display_name:"Bobby",avatar_path:"c/1",previous_name:null}],error:null});
 const res=await GET(req("Bob"));
 expect(mocks.rpc).toHaveBeenCalledWith("chat_tag_suggestions",{p_query:"Bob",p_hidden:[],p_limit:10});
 expect(mocks.ilike).not.toHaveBeenCalled();
 expect((await res.json()).members).toEqual([{id:"b",display_name:"Robert Bobson",previous_name:"Bob"},{id:"c",display_name:"Bobby",avatar_path:"c/1"}]);
});
it("a failing list is unavailable",async()=>{
 mocks.rpc.mockResolvedValue({data:null,error:{code:"57014",message:"canceling statement"}});
 expect((await GET(req("Bob"))).status).toBe(503);
});
