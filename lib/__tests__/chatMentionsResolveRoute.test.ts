import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
// #317: POST /api/chat/mentions says which tagged names belong to real members.
const mocks=vi.hoisted(()=>({auth:vi.fn(),member:vi.fn(),from:vi.fn(),select:vi.fn(),or:vi.fn(),limit:vi.fn(),avatar:vi.fn()}));
vi.mock("@/lib/chatAuth",()=>({requireChatUser:mocks.auth}));
vi.mock("@/lib/chatMembers",()=>({findChatMember:mocks.member,withAvatarColumn:(read:(avatar:boolean)=>unknown)=>read(mocks.avatar())}));
vi.mock("@/lib/chatAdmin",()=>({createChatAdminClient:()=>({from:mocks.from})}));
import { POST } from "@/app/api/chat/mentions/route";
const req=(body:unknown)=>new NextRequest("https://longboard.test/api/chat/mentions",{method:"POST",body:JSON.stringify(body)});
beforeEach(()=>{
 vi.clearAllMocks();mocks.avatar.mockReturnValue(true);
 mocks.auth.mockResolvedValue({ok:true,user:{id:"account"}});mocks.member.mockResolvedValue({id:"member"});
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
