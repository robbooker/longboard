import { describe, expect, it } from "vitest";
import { allowedChatRooms, allowedChatSearchRooms, canAccessChatRoom, canWriteChatRoom } from "@/lib/chatAccess";

describe("independent chat room entitlements", () => {
  it.each([
    [{ longboard: false, shortscout: false, admin: false }, []],
    [{ longboard: true, boardroom:true, shortscout: false, admin: false }, ["main", "social", "lb-announcements", "gainers","lb-recordings","whats-new"]],
    [{ longboard: false, shortscout: true, admin: false }, ["social", "shortscout", "ss-announcements", "gainers","ss-recordings","whats-new"]],
    [{ longboard: true, boardroom:true, shortscout: true, admin: false }, ["main", "social", "shortscout", "lb-announcements", "ss-announcements", "gainers","lb-recordings","ss-recordings","whats-new"]],
    [{ longboard: true, boardroom:true, shortscout: false, admin: true }, ["main", "social", "shortscout", "lb-announcements", "ss-announcements", "gainers","lb-recordings","ss-recordings","whats-new"]],
    [{ longboard: false, shortscout: false, admin: true }, []],
  ] as const)("maps %j to %j", (access, rooms) => {
    expect(allowedChatRooms(access)).toEqual(rooms);
  });
  it("SS-only cannot read LB through either a room or all-room search", () => {
    const access = { longboard: false, shortscout: true, admin: false };
    expect(canAccessChatRoom(access, "main")).toBe(false);
    expect(allowedChatSearchRooms(access)).toEqual(["social", "shortscout"]);
  });
  it("includes only entitled conversation rooms in search", () => {
    expect(allowedChatSearchRooms({ longboard: true, boardroom:true, shortscout: true, admin: false })).toEqual(["main", "social", "shortscout"]);
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
 expect(allowedChatRooms(admin)).toEqual(['main','social','shortscout','lb-announcements','ss-announcements','gainers','lb-recordings','ss-recordings','whats-new']);
 for(const room of ['unknown','features','dm',''])expect(canAccessChatRoom(admin,room as never)).toBe(false);
 expect(allowedChatRooms({...admin,admin:false})).toEqual(['social','gainers','whats-new']);
 expect(allowedChatSearchRooms(admin)).toEqual(['main','social','shortscout']);
});

it('paid non-mastermind identity retains Social without SS even for admins',()=>{for(const admin of [false,true])expect(allowedChatRooms({longboard:false,shortscout:false,shortscoutMember:true,admin})).toEqual(['social','gainers','whats-new']);});

it("#302 What's New: every chat member reads it, only admins post",()=>{
 const tiers=[{longboard:true,boardroom:true,shortscout:false,admin:false},{longboard:true,boardroom:false,shortscout:false,admin:false},
  {longboard:false,shortscout:true,admin:false},{longboard:false,shortscout:false,shortscoutMember:true,admin:false}];
 for(const access of tiers){expect(canAccessChatRoom(access,'whats-new')).toBe(true);expect(canWriteChatRoom(access,'whats-new')).toBe(false);}
 expect(canAccessChatRoom({longboard:false,shortscout:false,admin:false},'whats-new')).toBe(false);
 expect(canWriteChatRoom({longboard:true,boardroom:true,shortscout:false,admin:true},'whats-new')).toBe(true);
});
