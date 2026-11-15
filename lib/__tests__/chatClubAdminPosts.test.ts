import { describe, expect, it } from "vitest";
import { canWriteChatRoom, type ChatEntitlements } from "@/lib/chatAccess";
import { messageRepliesOff, roomRepliesOff } from "@/lib/publicChat";

// #457: chat admins post in Booker Stock Club; members, API tokens and agents never do.
const member: ChatEntitlements = { longboard: true, boardroom: true, shortscout: false, admin: false };
const admin: ChatEntitlements = { ...member, admin: true };
const browser = { apiToken: undefined, agent: undefined };

describe("Booker Stock Club posting", () => {
  it("an admin signed in through the browser posts", () => {
    expect(canWriteChatRoom(admin, "club", browser)).toBe(true);
    expect(canWriteChatRoom(admin, "club", {})).toBe(true);
  });
  it("a member never does", () => {
    expect(canWriteChatRoom(member, "club", browser)).toBe(false);
    expect(canWriteChatRoom({ longboard: false, shortscout: false, admin: false, member: ["club-room"] }, "club", browser)).toBe(false);
  });
  it("an API token never does, even an admin's own", () => {
    expect(canWriteChatRoom(admin, "club", { apiToken: true })).toBe(false);
    expect(canWriteChatRoom(member, "club", { apiToken: true })).toBe(false);
  });
  it("an agent never does, even with the room in its list", () => {
    const agentAccess: ChatEntitlements = { longboard: false, shortscout: false, admin: false, botRooms: ["club"] };
    expect(canWriteChatRoom(agentAccess, "club", { apiToken: true, agent: { id: "a" } })).toBe(false);
    expect(canWriteChatRoom({ ...agentAccess, admin: true }, "club", { agent: { id: "a" } })).toBe(false);
    expect(canWriteChatRoom({ ...admin, botRooms: ["club"] }, "club", browser)).toBe(false);
  });
  it("fails closed when the sign-in source is left out", () => {
    expect(canWriteChatRoom(admin, "club")).toBe(false);
  });
  it("leaves the other rooms as they were", () => {
    for (const source of [undefined, {}, { apiToken: true }]) {
      expect(canWriteChatRoom(admin, "gainers", source)).toBe(false);
      expect(canWriteChatRoom(member, "lb-announcements", source)).toBe(false);
      expect(canWriteChatRoom(admin, "lb-announcements", source)).toBe(true);
      expect(canWriteChatRoom(member, "main", source)).toBe(true);
    }
  });
  it("replies: under an admin's post, never under a stock-pick card or Longboard Bot", () => {
    expect(roomRepliesOff("club")).toBe(false);
    expect(messageRepliesOff("club", { bot_slug: null })).toBe(false);
    expect(messageRepliesOff("club", { bot_slug: "club" })).toBe(true);
    expect(messageRepliesOff("club", { bot_slug: "longboard" })).toBe(true);
    expect(messageRepliesOff("gainers", { bot_slug: null })).toBe(true);
    expect(messageRepliesOff("main", { bot_slug: "longboard" })).toBe(false);
  });
});
