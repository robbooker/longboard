import { describe, expect, it } from "vitest";
import { allowedChatRooms, allowedChatSearchRooms, allowedSummaryRooms, canAccessChatRoom, canWriteChatRoom } from "@/lib/chatAccess";

describe("independent chat room entitlements", () => {
  it.each([
    [{ longboard: false, shortscout: false, admin: false }, []],
    [{ longboard: true, boardroom:true, shortscout: false, admin: false }, ["main", "social", "lb-announcements", "gainers","lb-recordings","whats-new","developers"]],
    [{ longboard: false, shortscout: true, admin: false }, ["social", "shortscout", "ss-announcements", "gainers","ss-recordings","whats-new","developers"]],
    [{ longboard: true, boardroom:true, shortscout: true, admin: false }, ["main", "social", "shortscout", "lb-announcements", "ss-announcements", "gainers","lb-recordings","ss-recordings","whats-new","developers"]],
    [{ longboard: true, boardroom:true, shortscout: false, admin: true }, ["main", "social", "shortscout", "lb-announcements", "ss-announcements", "gainers","lb-recordings","ss-recordings","whats-new","developers","admins"]],
    [{ longboard: false, shortscout: false, admin: true }, []],
  ] as const)("maps %j to %j", (access, rooms) => {
    expect(allowedChatRooms(access)).toEqual(rooms);
  });
  it("SS-only cannot read LB through either a room or all-room search", () => {
    const access = { longboard: false, shortscout: true, admin: false };
    expect(canAccessChatRoom(access, "main")).toBe(false);
    expect(allowedChatSearchRooms(access)).toEqual(["social", "shortscout", "developers"]);
  });
  it("includes only entitled conversation rooms in search", () => {
    expect(allowedChatSearchRooms({ longboard: true, boardroom:true, shortscout: true, admin: false })).toEqual(["main", "social", "shortscout", "developers"]);
  });
});

it('announcement rooms enforce membership and admin posting',()=>{
 const lb={longboard:true,boardroom:true,shortscout:false,admin:false},ss={longboard:false,shortscout:true,admin:false};
 expect(canAccessChatRoom(lb,'lb-announcements')).toBe(true);
 expect(canAccessChatRoom(lb,'ss-announcements')).toBe(false);
 expect(canAccessChatRoom(ss,'lb-announcements')).toBe(false);
 expect(canAccessChatRoom(ss,'ss-announcements')).toBe(true);
 expect(canWriteChatRoom(lb,'lb-announcements')).toBe(false);
 expect(canWriteChatRoom(ss,'ss-announcements')).toBe(false);
 expect(canWriteChatRoom({...lb,admin:true},'ss-announcements')).toBe(true);
 expect(canWriteChatRoom({...lb,shortscout:true,admin:true},'ss-announcements')).toBe(true);
});

it('admin without cohort or SS identity can access all public rooms, never arbitrary/private rooms',()=>{
 const admin={longboard:true,shortscout:false,admin:true,boardroom:false};
 expect(allowedChatRooms(admin)).toEqual(['main','social','shortscout','lb-announcements','ss-announcements','gainers','lb-recordings','ss-recordings','whats-new','developers','admins']);
 for(const room of ['unknown','features','dm',''])expect(canAccessChatRoom(admin,room as never)).toBe(false);
 expect(allowedChatRooms({...admin,admin:false})).toEqual(['social','gainers','whats-new','developers']);
 expect(allowedChatSearchRooms(admin)).toEqual(['main','social','shortscout','developers','admins']);
});

it('paid non-mastermind identity retains Social without SS even for admins',()=>{for(const admin of [false,true])expect(allowedChatRooms({longboard:false,shortscout:false,shortscoutMember:true,admin})).toEqual(['social','gainers','whats-new','developers']);});

it("#302 What's New: every chat member reads it, only admins post",()=>{
 const tiers=[{longboard:true,boardroom:true,shortscout:false,admin:false},{longboard:true,boardroom:false,shortscout:false,admin:false},
  {longboard:false,shortscout:true,admin:false},{longboard:false,shortscout:false,shortscoutMember:true,admin:false}];
 for(const access of tiers){expect(canAccessChatRoom(access,'whats-new')).toBe(true);expect(canWriteChatRoom(access,'whats-new')).toBe(false);}
 expect(canAccessChatRoom({longboard:false,shortscout:false,admin:false},'whats-new')).toBe(false);
 expect(canWriteChatRoom({longboard:true,boardroom:true,shortscout:false,admin:true},'whats-new')).toBe(true);
});

it("#322 Developers: every chat member reads and posts, guests don't, other rooms unchanged",()=>{
 const tiers=[{longboard:true,boardroom:true,shortscout:false,admin:false},{longboard:true,boardroom:false,shortscout:false,admin:false},
  {longboard:false,shortscout:true,admin:false},{longboard:false,shortscout:false,shortscoutMember:true,admin:false},
  {longboard:true,boardroom:false,shortscout:false,admin:true}];
 for(const access of tiers){
  expect(canAccessChatRoom(access,'developers')).toBe(true);expect(canWriteChatRoom(access,'developers')).toBe(true);
  expect(allowedChatSearchRooms(access)).toContain('developers');
  // Exactly the same rule as Social.
  expect(canAccessChatRoom(access,'developers')).toBe(canAccessChatRoom(access,'social'));
 }
 const guest={longboard:false,shortscout:false,admin:false};
 expect(canAccessChatRoom(guest,'developers')).toBe(false);expect(canWriteChatRoom(guest,'developers')).toBe(false);
 expect(allowedChatSearchRooms(guest)).toEqual([]);
 // The room is listed last, so the rooms before it keep their order (and the default room).
 expect(allowedChatRooms({longboard:true,boardroom:true,shortscout:false,admin:false}).slice(0,-1)).toEqual(['main','social','lb-announcements','gainers','lb-recordings','whats-new']);
});

// #332: the Admins room belongs to admins only; no tier, and no bot's list, ever reaches it.
it.each([
 {longboard:true,boardroom:true,shortscout:true,admin:false},
 {longboard:true,shortscout:false,admin:false},
 {longboard:false,shortscout:true,admin:false},
 {longboard:false,shortscout:false,shortscoutMember:true,admin:false},
 {longboard:false,shortscout:false,admin:true},
 {longboard:false,shortscout:false,admin:false,botRooms:['developers','admins']},
])('%j cannot reach the Admins room',access=>{
 expect(allowedChatRooms(access)).not.toContain('admins');
 expect(canAccessChatRoom(access,'admins')).toBe(false);
 expect(canWriteChatRoom(access,'admins')).toBe(false);
 expect(allowedChatSearchRooms(access)).not.toContain('admins');
});
it('an admin can read, write and search the Admins room',()=>{
 const admin={longboard:true,shortscout:false,admin:true};
 expect(canWriteChatRoom(admin,'admins')).toBe(true);
 expect(allowedChatSearchRooms(admin)).toContain('admins');
});

it('#334: admins has no summaries but stays searchable',()=>{
 const admin={longboard:true,boardroom:true,shortscout:true,admin:true};
 expect(allowedSummaryRooms(admin)).not.toContain('admins');
 expect(allowedSummaryRooms(admin)).toEqual(allowedChatRooms(admin).filter(room=>room!=='admins'));
 expect(allowedChatSearchRooms(admin)).toContain('admins');
});
