import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks=vi.hoisted(()=>({auth:vi.fn(),member:vi.fn(),from:vi.fn(),select:vi.fn(),ilike:vi.fn(),limit:vi.fn()}));
vi.mock("@/lib/chatAuth",()=>({requireChatUser:mocks.auth}));
vi.mock("@/lib/chatMembers",()=>({findChatMember:mocks.member}));
vi.mock("@/lib/chatAdmin",()=>({createChatAdminClient:()=>({from:mocks.from})}));
import { GET } from "@/app/api/chat/mentions/route";
const req=(q="")=>new NextRequest(`https://longboard.test/api/chat/mentions?q=${encodeURIComponent(q)}`);
beforeEach(()=>{
 vi.clearAllMocks(); mocks.auth.mockResolvedValue({ok:true,access:{longboard:true,shortscout:false,admin:false},user:{id:"account"}});mocks.member.mockResolvedValue({id:"member"});
 mocks.from.mockReturnValue({select:mocks.select});mocks.select.mockReturnValue({ilike:mocks.ilike});mocks.ilike.mockReturnValue({order:()=>({limit:mocks.limit})});mocks.limit.mockResolvedValue({data:[{id:"other",display_name:"Rob"}],error:null});
});
it("requires a signed-in linked member",async()=>{
 mocks.auth.mockResolvedValue({ok:false,status:401,error:"unauthorized"});expect((await GET(req())).status).toBe(401);expect(mocks.from).not.toHaveBeenCalled();
 mocks.auth.mockResolvedValue({ok:true,access:{longboard:true,shortscout:false,admin:false},user:{id:"account"}});mocks.member.mockResolvedValue(null);expect((await GET(req())).status).toBe(403);
});
it("only selects public member identities and bounds the response",async()=>{
 expect((await GET(req("Rob"))).status).toBe(200);expect(mocks.select).toHaveBeenCalledWith("id, display_name");expect(mocks.limit).toHaveBeenCalledWith(10);
});
it("rejects wildcard input and escapes literal underscores",async()=>{
 expect((await GET(req("%"))).status).toBe(400);await GET(req("Rob_"));expect(mocks.ilike).toHaveBeenCalledWith("display_name","Rob\\_%");
});
