import { describe, expect, it } from "vitest";
import { allowedChatRooms, allowedChatSearchRooms, canAccessChatRoom } from "@/lib/chatAccess";

describe("independent chat room entitlements", () => {
  it.each([
    [{ longboard: false, shortscout: false, admin: false }, []],
    [{ longboard: true, shortscout: false, admin: false }, ["main", "social"]],
    [{ longboard: false, shortscout: true, admin: false }, ["social", "shortscout"]],
    [{ longboard: true, shortscout: true, admin: false }, ["main", "social", "shortscout"]],
    [{ longboard: true, shortscout: false, admin: true }, ["main", "social", "shortscout"]],
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
    expect(allowedChatSearchRooms({ longboard: true, shortscout: true, admin: false })).toEqual(["main", "social"]);
  });
});
