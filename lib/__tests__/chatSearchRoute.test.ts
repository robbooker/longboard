import {beforeEach,describe,it,expect,vi} from "vitest";
import {NextRequest} from "next/server";
const mock=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn()}));
vi.mock("@/lib/auth",()=>({requireUser:mock.auth}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({rpc:mock.rpc})}));
import {GET} from "@/app/api/chat/search/route";
import {GET as context} from "@/app/api/chat/search/context/route";
const req=(query:string)=>new NextRequest(`https://longboard.test/api/chat/search?${query}`);
beforeEach(()=>{vi.clearAllMocks();mock.auth.mockResolvedValue({ok:true,user:{id:"member"}});mock.rpc.mockResolvedValue({data:[],error:null});});
describe("member chat search",()=>{
 it("blocks anonymous search and context before querying",async()=>{mock.auth.mockResolvedValue({ok:false,status:401,error:"unauthenticated"});expect((await GET(req("q=hello"))).status).toBe(401);expect((await context(req("id=bad"))).status).toBe(401);expect(mock.rpc).not.toHaveBeenCalled();});
 it("rejects missing profiles",async()=>{mock.auth.mockResolvedValue({ok:false,status:403,error:"no_profile"});expect((await GET(req("q=hello"))).status).toBe(403);});
 it("validates scope, length and pagination",async()=>{for(const q of ["q=a","q=hello&room=private","q=hello&before=bad","q=hello&beforeId=bad"])expect((await GET(req(q))).status).toBe(400);expect(mock.rpc).not.toHaveBeenCalled();});
 it("bounds results and reports another page",async()=>{mock.rpc.mockResolvedValue({data:Array.from({length:21},(_,i)=>({id:String(i)})),error:null});const r=await GET(req("q=AAPL&room=all"));const data=await r.json();expect(data.messages).toHaveLength(20);expect(data.hasMore).toBe(true);expect(r.headers.get("Cache-Control")).toBe("no-store");expect(mock.rpc).toHaveBeenCalledWith("search_longboard_chat",{p_query:"AAPL",p_room:"all",p_before:null,p_before_id:null});});
 it("does not expose database errors",async()=>{mock.rpc.mockResolvedValue({data:null,error:{message:"sensitive diagnostic"}});const r=await GET(req("q=hello"));expect(r.status).toBe(503);expect(await r.text()).not.toContain("sensitive");});
});
