import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks=vi.hoisted(()=>({auth:vi.fn(),member:vi.fn(),from:vi.fn(),insert:vi.fn(),buddy:vi.fn(),answer:vi.fn()}));
vi.mock("@/lib/chatAuth",()=>({requireChatUser:mocks.auth}));
vi.mock("@/lib/chatMembers",()=>({findChatMember:mocks.member}));
vi.mock("@supabase/supabase-js",()=>({createClient:()=>({from:mocks.from})}));
vi.mock("@/lib/chatAdmin",()=>({requestOriginAllowed:()=>true,readPublicRoomState:async()=>({isOpen:true})}));
vi.mock("@/lib/chatBuddy",()=>({hasBuddyMention:mocks.buddy,answerBuddy:mocks.answer}));
import { GET, POST } from "@/app/api/chat/route";
const memberId="00000000-0000-4000-8000-000000000001";
const req=(room?: unknown)=>new NextRequest("https://longboard.test/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"send",room,body:"Hello",member_id:"spoofed",guest_id:"spoofed",author_label:"Other member"})});
beforeEach(()=>{
 vi.clearAllMocks();vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL","https://example.supabase.co");vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY","test");
 mocks.buddy.mockReturnValue(false);
 mocks.auth.mockResolvedValue({ok:true,access:{longboard:true,shortscout:false,admin:false},user:{id:"account-id"}});
 mocks.member.mockResolvedValue({id:memberId,display_name:"Trusted name"});
 mocks.from.mockImplementation(()=>({
  select:()=>({eq:()=>({gte:()=>({order:()=>({limit:async()=>({data:[],error:null})})})})}),
  insert:mocks.insert,
 }));
 mocks.insert.mockReturnValue({select:()=>({single:async()=>({data:{id:"message-id",body:"Hello"},error:null})})});
});
describe("account-linked public chat",()=>{
 it("rejects non-admin SHORTSCOUT reads and writes",async()=>{
  expect((await GET(new NextRequest("https://longboard.test/api/chat?room=shortscout"))).status).toBe(403);
  expect((await POST(req("shortscout"))).status).toBe(403);
  expect(mocks.insert).not.toHaveBeenCalled();
 });
 it("allows admins to post to SHORTSCOUT without invoking Buddy",async()=>{
  mocks.auth.mockResolvedValue({ok:true,access:{longboard:true,shortscout:false,admin:true},user:{id:"account-id",role:"admin"}});
  mocks.buddy.mockReturnValue(true);
  expect((await POST(req("shortscout"))).status).toBe(200);
  expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({room_slug:"shortscout"}));
  expect(mocks.answer).not.toHaveBeenCalled();
 });
 it("requires authentication for history status and every write action",async()=>{
  mocks.auth.mockResolvedValue({ok:false,status:401,error:"unauthenticated"});
  expect((await GET(new NextRequest("https://longboard.test/api/chat"))).status).toBe(401);
  for (const action of ["register","session","send","react"]) {
    const request=new NextRequest("https://longboard.test/api/chat",{method:"POST",body:JSON.stringify({action,token:memberId,body:"Guest bypass"})});
    expect((await POST(request)).status).toBe(401);
  }
  expect(mocks.from).not.toHaveBeenCalled();
 });
 it("routes Social messages separately",async()=>{
  mocks.buddy.mockReturnValue(true);
  expect((await POST(req("social"))).status).toBe(200);
  expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({room_slug:"social"}));
  expect(mocks.answer).not.toHaveBeenCalled();
 });
 it("rejects invalid rooms before writing",async()=>{
  expect((await POST(req("other"))).status).toBe(400);
  expect(mocks.insert).not.toHaveBeenCalled();
 });
 it("posts using the verified member rather than payload or guest credentials",async()=>{
  expect((await POST(req())).status).toBe(200);
  expect(mocks.insert).toHaveBeenCalledWith({guest_id:memberId,member_id:memberId,author_label:"Trusted name",body:"Hello",room_slug:"main"});
 });
 it("does not let signed-in accounts fall back to guest identities",async()=>{
  mocks.member.mockResolvedValue(null);
  expect((await POST(req())).status).toBe(409);expect(mocks.insert).not.toHaveBeenCalled();
 });
 it("does not bypass a missing member profile by treating it as a guest",async()=>{
  mocks.auth.mockResolvedValue({ok:false,status:403,error:"no_profile"});
  expect((await POST(req())).status).toBe(403);expect(mocks.insert).not.toHaveBeenCalled();
 });
 it("fails closed when account lookup fails",async()=>{
  mocks.member.mockRejectedValue(new Error("unavailable"));
  expect((await POST(req())).status).toBe(503);expect(mocks.insert).not.toHaveBeenCalled();
 });
});
