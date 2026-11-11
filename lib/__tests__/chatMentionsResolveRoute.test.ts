import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
// #317: POST /api/chat/mentions says which tagged names belong to real members.
const mocks=vi.hoisted(()=>({auth:vi.fn(),member:vi.fn(),from:vi.fn(),select:vi.fn(),or:vi.fn(),limit:vi.fn(),avatar:vi.fn(),rpc:vi.fn()}));
vi.mock("@/lib/chatAuth",()=>({requireChatUser:mocks.auth}));
vi.mock("@/lib/chatMembers",()=>({CHAT_UUID:/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,findChatMember:mocks.member,withAvatarColumn:(read:(avatar:boolean)=>unknown)=>read(mocks.avatar())}));
vi.mock("@/lib/chatAdmin",()=>({createChatAdminClient:()=>({from:mocks.from,rpc:mocks.rpc})}));
import { POST } from "@/app/api/chat/mentions/route";
const req=(body:unknown)=>new NextRequest("https://longboard.test/api/chat/mentions",{method:"POST",body:JSON.stringify(body)});
const ACCESS={boardroom:false,longboard:true,shortscout:false,shortscoutMember:false,admin:false};
// The tests below #439's are the lookup before its migration (the database function is missing).
const MISSING={data:null,error:{code:"PGRST202",message:"Could not find the function public.chat_tag_lookup"}};
beforeEach(()=>{
 mocks.rpc.mockResolvedValue(MISSING);
 vi.clearAllMocks();mocks.avatar.mockReturnValue(true);
 mocks.auth.mockResolvedValue({ok:true,access:ACCESS,user:{id:"account"}});mocks.member.mockResolvedValue({id:"member"});
 mocks.from.mockReturnValue({select:mocks.select});mocks.select.mockReturnValue({or:mocks.or});mocks.or.mockReturnValue({limit:mocks.limit});
 mocks.limit.mockResolvedValue({data:[{id:"a",display_name:"Jammie"},{id:"b",display_name:"Jxmmie"},{id:"c",display_name:"Jammie Smith"}],error:null});
});
it("requires a signed-in member",async()=>{
 mocks.auth.mockResolvedValue({ok:false,status:401,error:"unauthorized"});expect((await POST(req({names:["jammie"]}))).status).toBe(401);
 mocks.auth.mockResolvedValue({ok:true,user:{id:"account"}});mocks.member.mockResolvedValue(null);expect((await POST(req({names:["jammie"]}))).status).toBe(403);
});
it("returns only exact, case-blind matches (an underscore wildcard cannot widen it)",async()=>{
 const res=await POST(req({names:["JAMMIE","j_mmie","nobody"]}));
 expect(res.status).toBe(200);
 expect(mocks.select).toHaveBeenCalledWith("id, display_name, avatar_path");
 expect(mocks.or).toHaveBeenCalledWith('display_name.ilike."jammie",display_name.ilike."j_mmie",display_name.ilike."nobody"');
 expect((await res.json()).members).toEqual([{id:"a",display_name:"Jammie"}]);
});
it("drops names that could break the filter and bounds the request",async()=>{
 const res=await POST(req({names:['a"b','x,y','%','ok name',1]}));
 expect(mocks.or).toHaveBeenCalledWith('display_name.ilike."ok name"');
 expect(res.status).toBe(200);
 expect((await POST(req({names:Array(61).fill("ab")}))).status).toBe(400);
 expect((await POST(req({}))).status).toBe(400);
 mocks.or.mockClear();expect((await (await POST(req({names:["!"]}))).json()).members).toEqual([]);expect(mocks.or).not.toHaveBeenCalled();
});
// #414: a tag opens the larger view of that member, so their picture name comes with them.
it("sends a member's picture name when they have one, and nothing else about them",async()=>{
 mocks.limit.mockResolvedValue({data:[{id:"a",display_name:"Jammie",avatar_path:"a/1"},{id:"d",display_name:"Rob",avatar_path:null}],error:null});
 expect((await (await POST(req({names:["jammie","rob"]}))).json()).members).toEqual([{id:"a",display_name:"Jammie",avatar_path:"a/1"},{id:"d",display_name:"Rob"}]);
});
it("still answers before the picture column exists",async()=>{
 mocks.avatar.mockReturnValue(false);
 const res=await POST(req({names:["jammie"]}));
 expect(mocks.select).toHaveBeenCalledWith("id, display_name");
 expect((await res.json()).members).toEqual([{id:"a",display_name:"Jammie"}]);
});

// #439: stored tags hold the person; the database lookup answers names and shown messages together.
const M1="11111111-1111-4111-8111-111111111111",M2="22222222-2222-4222-8222-222222222222";
it("asks the database for names and shown messages in the reader's rooms, and answers tags with current names",async()=>{
 mocks.rpc.mockResolvedValue({data:[
  {message_id:null,tag_key:"jammie",member_id:"a",display_name:"Jammie",avatar_path:"a/1"},
  {message_id:M1,tag_key:"bob",member_id:"b",display_name:"Robert Bobson",avatar_path:null},
 ],error:null});
 const res=await POST(req({names:["JAMMIE"],messages:[M1,M1,"not-a-uuid",M2]}));
 expect(res.status).toBe(200);
 expect(mocks.rpc).toHaveBeenCalledWith("chat_tag_lookup",{p_actor:"account",p_rooms:expect.arrayContaining(["social"]),p_names:["jammie"],p_messages:[M1,M2]});
 expect(mocks.from).not.toHaveBeenCalled();
 expect(await res.json()).toEqual({members:[{id:"a",display_name:"Jammie",avatar_path:"a/1"}],tags:[{message_id:M1,key:"bob",member:{id:"b",display_name:"Robert Bobson"}}]});
});
it("answers shown messages even with no names, and bounds them",async()=>{
 mocks.rpc.mockResolvedValue({data:[],error:null});
 expect((await POST(req({names:[],messages:[M1]}))).status).toBe(200);
 expect(mocks.rpc).toHaveBeenCalledWith("chat_tag_lookup",expect.objectContaining({p_names:[],p_messages:[M1]}));
 expect((await POST(req({names:[],messages:Array(61).fill(M1)}))).status).toBe(400);
 expect((await POST(req({names:[],messages:"x"}))).status).toBe(400);
});
it("never lists a room the reader cannot open",async()=>{
 mocks.rpc.mockResolvedValue({data:[],error:null});
 await POST(req({names:["jammie"],messages:[M1]}));
 expect(mocks.rpc.mock.calls[0][1].p_rooms).not.toContain("main");
 mocks.auth.mockResolvedValue({ok:true,access:{...ACCESS,botRooms:["developers"]},user:{id:"bot"}});
 await POST(req({names:["jammie"],messages:[M1]}));
 expect(mocks.rpc.mock.calls[1][1].p_rooms).toEqual(["developers"]);
});
it("a failing lookup is unavailable, not a silent fallback",async()=>{
 mocks.rpc.mockResolvedValue({data:null,error:{code:"57014",message:"canceling statement"}});
 expect((await POST(req({names:["jammie"]}))).status).toBe(503);
 expect(mocks.from).not.toHaveBeenCalled();
});
