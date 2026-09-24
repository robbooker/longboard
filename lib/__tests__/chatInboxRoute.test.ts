const pushAfter=vi.hoisted(()=>vi.fn());
vi.mock('next/server',async original=>({...await original<typeof import('next/server')>(),after:pushAfter}));
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mock = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), client: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: mock.auth }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mock.client }));
vi.mock("@/lib/chatAdmin", () => ({ createChatAdminClient: mock.admin, requestOriginAllowed: (req: NextRequest) => !req.headers.get("origin") || req.headers.get("origin") === "https://longboard.test" }));
import { GET, POST } from "@/app/api/chat/inbox/route";
const actor="00000000-0000-4000-8000-000000000001";
const target="00000000-0000-4000-8000-000000000002";
const clientId="00000000-0000-4000-8000-000000000003";
function request(body: unknown, origin="https://longboard.test") { return new NextRequest("https://longboard.test/api/chat/inbox", { method:"POST", headers:{"Content-Type":"application/json",origin}, body:JSON.stringify(body) }); }
beforeEach(() => { vi.clearAllMocks(); mock.auth.mockResolvedValue({ok:true,access:{longboard:true,boardroom:true,shortscout:false,admin:false},user:{id:actor,email:"test@example.invalid",role:"user"}}); mock.admin.mockReturnValue({rpc:mock.rpc}); mock.rpc.mockResolvedValue({data:{conversationId:target},error:null}); });
describe("private inbox API boundary", () => {
 it("rejects unauthenticated reads and writes before touching data",async()=>{
  mock.auth.mockResolvedValue({ok:false,status:401,error:"unauthenticated"});
  expect((await GET(new NextRequest("https://longboard.test/api/chat/inbox"))).status).toBe(401);
  expect((await POST(request({action:"request",target,body:"Hi",clientId}))).status).toBe(401);
  expect(mock.rpc).not.toHaveBeenCalled();
 });
 it("uses only the verified account, ignoring spoofed actor IDs",async()=>{
  expect((await POST(request({action:"request",target,body:"Hi",clientId,userId:target,p_user_id:target}))).status).toBe(200);
  expect(pushAfter).toHaveBeenCalledOnce();
  expect(mock.rpc).toHaveBeenCalledWith("send_chat_dm_ack",expect.objectContaining({p_user_id:actor,p_target:target,p_action:"request"}));
 });
 it("rejects foreign origins",async()=>{
  expect((await POST(request({action:"accept",target},"https://evil.test"))).status).toBe(403);
  expect(mock.auth).not.toHaveBeenCalled();
 });
 it.each([{action:"send",target,body:"Hi"},{action:"request",target:"not-id",body:"Hi",clientId},{action:"settings",value:"true"},{action:"send",target,body:"x".repeat(2001),clientId},{action:"delete",target}])("validates payload %j",async(body)=>{
  expect((await POST(request(body))).status).toBe(400); expect(mock.rpc).not.toHaveBeenCalled();
 });
 it("maps database request rules to readable errors",async()=>{
  mock.rpc.mockResolvedValue({data:null,error:{message:"request_not_accepted"}});
  const result=await POST(request({action:"send",target,body:"Hi",clientId}));
  expect(result.status).toBe(409);expect((await result.json()).error).toMatch(/accept/);
 });
 it("returns rate limits without leaking internal database errors",async()=>{
  mock.rpc.mockResolvedValue({error:{message:"request_rate_limited"}});
  expect((await POST(request({action:"request",target,body:"Hi",clientId}))).status).toBe(429);
  mock.rpc.mockResolvedValue({error:{message:"internal secret detail"}});
  expect((await (await POST(request({action:"accept",target}))).json()).error).not.toContain("secret");
 });
 it("rejects outsiders with an explicit verified-participant filter",async()=>{
  const maybeSingle=vi.fn().mockResolvedValue({data:null,error:null});
  const or=vi.fn().mockReturnValue({maybeSingle});
  mock.admin.mockReturnValue({from:(table:string)=>({select:()=>({eq:()=>table==="longboard_chat_members"?{maybeSingle:async()=>({data:{id:actor},error:null})}:{or}})})});
  const result=await GET(new NextRequest(`https://longboard.test/api/chat/inbox?conversation=${target}`));
  expect(result.status).toBe(404); expect(or).toHaveBeenCalledWith(`requester_id.eq.${actor},recipient_id.eq.${actor}`);
 });
});

describe('private summary inbox',()=>{
 it('scopes summary history to the verified account and current room entitlements',async()=>{
  const eq=vi.fn(),inside=vi.fn();const q={select:()=>q,eq:(...args:unknown[])=>{eq(...args);return q;},in:(...args:unknown[])=>{inside(...args);return q;},order:()=>q,limit:async()=>({data:[{id:clientId,seq:1,body:'Private summary',created_at:'2026-09-16'}]})};
  mock.admin.mockReturnValue({from:()=>q});
  const response=await GET(new NextRequest('https://longboard.test/api/chat/inbox?conversation=room-summaries&account_id=attacker'));
  expect(response.status).toBe(200);expect(eq).toHaveBeenCalledWith('account_id',actor);expect(inside).toHaveBeenCalledWith('room_slug',['main','social','lb-announcements','gainers','lb-recordings']);
  expect((await response.json()).messages[0].sender_id).toBe('room-summaries');
 });
 it('cannot mark another user summary read',async()=>{
  const eq=vi.fn();const q={select:()=>q,eq:(...args:unknown[])=>{eq(...args);return q;},in:()=>q,maybeSingle:async()=>({data:null})};
  mock.admin.mockReturnValue({from:()=>q});
  const response=await POST(request({action:'read',target:'room-summaries',clientId}));
  expect(response.status).toBe(404);expect(eq).toHaveBeenCalledWith('account_id',actor);
 });
 it('does not allow sending a human DM to the summary system thread',async()=>{
  expect((await POST(request({action:'send',target:'room-summaries',clientId,body:'hello'}))).status).toBe(400);expect(mock.rpc).not.toHaveBeenCalled();
 });
});
