import { describe, expect, it } from "vitest";
import { allowedChatRooms, allowedChatSearchRooms, canAccessChatRoom, canWriteChatRoom } from "@/lib/chatAccess";

describe("independent chat room entitlements", () => {
  it.each([
    [{ longboard: false, shortscout: false, admin: false }, []],
    [{ longboard: true, boardroom:true, shortscout: false, admin: false }, ["main", "social", "lb-announcements"]],
    [{ longboard: false, shortscout: true, admin: false }, ["social", "shortscout", "ss-announcements"]],
    [{ longboard: true, boardroom:true, shortscout: true, admin: false }, ["main", "social", "shortscout", "lb-announcements", "ss-announcements"]],
    [{ longboard: true, boardroom:true, shortscout: false, admin: true }, ["main", "social", "shortscout", "lb-announcements", "ss-announcements"]],
    [{ longboard: false, shortscout: false, admin: true }, []],
  ] as const)("maps %j to %j", (access, rooms) => {
    expect(allowedChatRooms(access)).toEqual(rooms);
  });
  it("SS-only cannot read LB through either a room or all-room search", () => {
    const access = { longboard: false, shortscout: true, admin: false };
    expect(canAccessChatRoom(access, "main")).toBe(false);
    expect(allowedChatSearchRooms(access)).toEqual(["social"]);
  });
  it("keeps SS out of the existing LB/SOCIAL search index", () => {
    expect(allowedChatSearchRooms({ longboard: true, boardroom:true, shortscout: true, admin: false })).toEqual(["main", "social"]);
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
 expect(allowedChatRooms(admin)).toEqual(['main','social','shortscout','lb-announcements','ss-announcements']);
 for(const room of ['unknown','features','dm',''])expect(canAccessChatRoom(admin,room as never)).toBe(false);
 expect(allowedChatRooms({...admin,admin:false})).toEqual(['social']);
 expect(allowedChatSearchRooms(admin)).toEqual(['main','social']);
});

it('paid non-mastermind identity retains Social without SS even for admins',()=>{for(const admin of [false,true])expect(allowedChatRooms({longboard:false,shortscout:false,shortscoutMember:true,admin})).toEqual(['social']);});
