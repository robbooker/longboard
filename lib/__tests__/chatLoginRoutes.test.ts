import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { chatLoginChallenge, newChatLoginSecret } from "@/lib/chatLoginProof";
const mock=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn(),lookup:vi.fn(),verify:vi.fn(),from:vi.fn()}));
vi.mock("@/lib/auth",()=>({getCurrentUser:mock.auth}));
vi.mock("@/lib/shortscoutMembership",()=>({verifyShortScoutMembership:mock.verify}));
vi.mock("@/lib/chatAdmin",()=>({createChatAdminClient:()=>({from:mock.from,rpc:mock.rpc})}));
import { GET } from "@/app/api/chat/login/callback/route";
import { POST } from "@/app/api/chat/login/authorize/route";
const state=newChatLoginSecret(), verifier=newChatLoginSecret(),code=newChatLoginSecret();
const callback=(cookie=`${state}.${verifier}`)=>new NextRequest(`https://www.longboardai.com/api/chat/login/callback?state=${state}&code=${code}`,{headers:{cookie:`lb-chat-login=${cookie}`}});
beforeEach(()=>{
 vi.clearAllMocks();
 const builder:Record<string,unknown>={};
 for(const method of ["select","eq","is","gt","update"]) builder[method]=()=>builder;
 builder.maybeSingle=mock.lookup;
 mock.from.mockReturnValue(builder);
 mock.lookup.mockResolvedValue({data:{link_user_id:null},error:null});
 mock.auth.mockResolvedValue({ok:false,status:401});
 mock.rpc.mockResolvedValue({data:{room:"shortscout",popout:true},error:null});
 mock.verify.mockResolvedValue({ok:true,subject:"verified",level:"mastermind"});
});
describe("chat login HTTP boundaries",()=>{
 it("rejects missing or mismatched browser state before database access",async()=>{
  expect((await GET(callback(""))).status).toBe(400);
  expect((await GET(callback(`${newChatLoginSecret()}.${verifier}`))).status).toBe(400);
  expect(mock.from).not.toHaveBeenCalled();
 });
 it("uses hashed code and original browser challenge; session cookie is HTTP-only",async()=>{
  const response=await GET(callback());
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe("https://www.longboardai.com/chat?room=shortscout&popout=1");
  expect(mock.rpc).toHaveBeenCalledWith("consume_chat_login",expect.objectContaining({p_challenge:chatLoginChallenge(verifier),p_link_user_id:null}));
  const args=mock.rpc.mock.calls[0][1];
  expect(args.p_code_hash).not.toBe(code);
  expect(args.p_session_hash).toMatch(/^[0-9a-f]{64}$/);
  expect(response.headers.get("set-cookie")).toContain("HttpOnly");
 });
 it("requires the same Longboard session when linking",async()=>{
  mock.lookup.mockResolvedValue({data:{link_user_id:"owner"},error:null});
  mock.auth.mockResolvedValue({ok:true,user:{id:"other"}});
  expect((await GET(callback())).status).toBe(400);
  expect(mock.rpc).not.toHaveBeenCalled();
 });
 it("does not create a cookie when the one-use code is refused",async()=>{
  mock.rpc.mockResolvedValue({data:null,error:{message:"invalid_login_handoff"}});
  const response=await GET(callback());
  expect(response.status).toBe(400);expect(response.headers.get("set-cookie")).toBeNull();
 });
 it("rejects foreign origins before checking the user token",async()=>{
  const response=await POST(new NextRequest("https://www.longboardai.com/api/chat/login/authorize",{method:"POST",headers:{origin:"https://evil.example"},body:JSON.stringify({state})}));
  expect(response.status).toBe(403);expect(mock.verify).not.toHaveBeenCalled();
 });
 it("free members cannot receive a login code",async()=>{
  mock.verify.mockResolvedValue({ok:false,reason:"not_paid"});
  const response=await POST(new NextRequest("https://www.longboardai.com/api/chat/login/authorize",{method:"POST",headers:{origin:"https://shortscout.ai",authorization:"Bearer free-token"},body:JSON.stringify({state})}));
  expect(response.status).toBe(403);expect(await response.json()).toEqual({error:"not_paid"});
 });
});
