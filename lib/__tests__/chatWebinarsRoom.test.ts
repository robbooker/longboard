// #537: the Webinars room (open chat for all-member webinars) and its recordings room
// (Recordings > Booker Stock Club). The rules in lib/chatAccess.ts and the room lists; the database
// has the same rules (scripts/tests/chat-webinars-room-database.mjs checks the real functions).
//  - who can open them: every LB member, every SS member (any paid tier), Booker Stock Club buyers
//    and admins; nobody signed out, no bot account unless its own list names the room, no agent;
//  - Webinars: everyone who can open it posts and replies (as in Social); it offers live video;
//  - the recordings room: admins post, members read and react; no replies; no live video;
//  - Booker Stock Club itself is exactly as it was: read-only for members.
import { describe, expect, it } from "vitest";
import {
  allowedChatRooms,
  allowedChatSearchRooms,
  allowedSummaryRooms,
  canAccessChatRoom,
  canStartChatPost,
  canWriteChatRoom,
  clubRoomAccess,
  webinarsRoomAccess,
  type ChatEntitlements,
} from "@/lib/chatAccess";
import { AGENT_ROOMS } from "@/lib/chatAgents";
import { CARD_DEFINITIONS } from "@/lib/chatCards";
import { ANNOUNCE_ROOMS } from "@/lib/chatLongboardBot";
import { quadChoices } from "@/lib/chatQuad";
import { chatSearchScopes } from "@/lib/chatSearchScopes";
import { isStageRoom } from "@/lib/chatStageLive";
import { stageWatchPath } from "@/lib/chatStageNotice";
import { stageRecordingRooms } from "@/lib/chatStageRecording";
import { parseSummaryCommand } from "@/lib/chatSummaryCommand";
import { CHAT_ROOMS, isAnnouncementRoom, isRecordingRoom, messageRepliesOff, parseChatRoom, roomHasSummaries, roomRepliesOff } from "@/lib/publicChat";

const none: ChatEntitlements = { longboard: false, shortscout: false, admin: false };
const people: [string, ChatEntitlements][] = [
  ["an LB member in the Boardroom", { ...none, longboard: true, boardroom: true }],
  ["an LB member outside the Boardroom", { ...none, longboard: true }],
  ["an SS mastermind member", { ...none, shortscout: true }],
  ["an SS member of another paid tier", { ...none, shortscoutMember: true }],
  ["a Booker Stock Club buyer (club-room)", { ...none, member: ["club-room"] }],
  ["a Booker Stock Club buyer (the Gainers rule)", { ...none, member: ["gainers"] }],
  ["an admin", { ...none, longboard: true, admin: true }],
];
const outsiders: [string, ChatEntitlements][] = [
  ["someone with no membership (signed out resolves to no access at all)", none],
  ["a buyer of something else", { ...none, member: ["reader"] }],
  ["a bot account that does not list the room", { ...none, longboard: true, botRooms: ["developers", "social"] }],
  ["an admin's bot account", { ...none, longboard: true, admin: true, botRooms: ["developers"] }],
  ["an agent (it reads only its owner's listed rooms, and neither room can be listed)", { ...none, longboard: true, botRooms: ["social", "club"] }],
];
const browser = {};
const token = { apiToken: true };
const agent = { apiToken: true, agent: { id: "a1" } };

describe("the rooms", () => {
  it("are known rooms, named Webinars and Booker Stock Club Recordings", () => {
    expect(CHAT_ROOMS.find((room) => room.slug === "webinars")?.label).toBe("Webinars");
    expect(CHAT_ROOMS.find((room) => room.slug === "club-recordings")?.label).toBe("Booker Stock Club Recordings");
    expect(parseChatRoom("webinars")).toBe("webinars");
    expect(parseChatRoom("club-recordings")).toBe("club-recordings");
    expect(parseChatRoom("webinar")).toBeNull();
    // Webinars sits right after Booker Stock Club; the recordings room after SS Recordings.
    const slugs = CHAT_ROOMS.map((room) => room.slug);
    expect(slugs.indexOf("webinars")).toBe(slugs.indexOf("club") + 1);
    expect(slugs.indexOf("club-recordings")).toBe(slugs.indexOf("ss-recordings") + 1);
  });
  it("the stage link is /chat?room=webinars&stage=1", () => {
    expect(stageWatchPath("webinars")).toBe("/chat?room=webinars&stage=1");
  });
});

describe("who can open them", () => {
  it.each(people)("%s has Webinars and its recordings, exactly when they have Booker Stock Club", (_name, access) => {
    expect(clubRoomAccess(access)).toBe(true);
    expect(webinarsRoomAccess(access)).toBe(true);
    for (const room of ["webinars", "club-recordings"] as const) {
      expect(canAccessChatRoom(access, room)).toBe(true);
      expect(canAccessChatRoom(access, room)).toBe(canAccessChatRoom(access, "club"));
    }
  });
  it.each(outsiders)("%s has neither", (_name, access) => {
    expect(canAccessChatRoom(access, "webinars")).toBe(false);
    expect(canAccessChatRoom(access, "club-recordings")).toBe(false);
    expect(canWriteChatRoom(access, "webinars", browser)).toBe(false);
    expect(canWriteChatRoom(access, "club-recordings", browser)).toBe(false);
  });
  it("a bot account has the room only when its own list names it (the existing rule); agents cannot be given it", () => {
    expect(canAccessChatRoom({ ...none, longboard: true, botRooms: ["webinars"] }, "webinars")).toBe(true);
    expect(AGENT_ROOMS as readonly string[]).not.toContain("webinars");
    expect(AGENT_ROOMS as readonly string[]).not.toContain("club-recordings");
  });
  it("the rooms come after the ones a member already had, so nobody's first room changes", () => {
    for (const [, access] of people.slice(0, 6)) {
      const rooms = allowedChatRooms(access);
      const before = rooms.filter((room) => room !== "webinars" && room !== "club-recordings");
      expect(rooms.slice(0, rooms.indexOf("webinars"))).toEqual(before.slice(0, rooms.indexOf("webinars")));
      expect(rooms[0]).toBe(before[0]);
      expect(rooms.indexOf("webinars")).toBe(rooms.indexOf("club") + 1);
    }
    expect(allowedChatRooms({ ...none, member: ["club-room"] })).toEqual(["club", "webinars", "club-recordings"]);
  });
});

describe("Webinars: chat is open", () => {
  it.each(people)("%s posts and replies there, signed in through the browser", (_name, access) => {
    expect(canWriteChatRoom(access, "webinars", browser)).toBe(true);
    expect(canStartChatPost(access, "webinars", browser)).toBe(true);
  });
  it("is an ordinary room: not an announcement room, replies on, under any post", () => {
    expect(isAnnouncementRoom("webinars")).toBe(false);
    expect(isRecordingRoom("webinars")).toBe(false);
    expect(roomRepliesOff("webinars")).toBe(false);
    expect(messageRepliesOff("webinars", { bot_slug: null })).toBe(false);
  });
  it("as in Social, a member's own API token posts as the member; an agent cannot be given the room", () => {
    const member = { ...none, longboard: true };
    expect(canWriteChatRoom(member, "webinars", token)).toBe(canWriteChatRoom(member, "social", token));
    // An agent's access is its listed rooms only, and Webinars cannot be listed.
    expect(canWriteChatRoom({ ...member, botRooms: ["social"] }, "webinars", agent)).toBe(false);
  });
  it("offers live video, search and summaries, as Social does", () => {
    expect(isStageRoom("webinars")).toBe(true);
    const buyer = { ...none, member: ["club-room"] };
    expect(allowedChatSearchRooms(buyer)).toEqual(["webinars"]);
    expect(chatSearchScopes(allowedChatRooms(buyer)).map((scope) => scope.value)).toEqual(["webinars"]);
    expect(roomHasSummaries("webinars")).toBe(true);
    expect(allowedSummaryRooms(buyer)).toContain("webinars");
    expect(parseSummaryCommand("/summary webinars", "social")).toEqual({ room: "webinars" });
  });
  it("is offered in Dual, Quad and Six view and as a live-video card, to those who have it", () => {
    const rooms = allowedChatRooms({ ...none, member: ["club-room"] });
    expect(quadChoices(rooms, [], [], true).map((choice) => choice.key)).toEqual(expect.arrayContaining(["room:webinars", "video:webinars"]));
    expect(quadChoices(allowedChatRooms({ ...none, member: ["reader"] }), [], [], true).map((choice) => choice.key)).not.toContain("room:webinars");
    const options = { rooms, conversations: [], stageVideo: true } as never;
    expect(CARD_DEFINITIONS.room.sources?.(options).map((source) => source.source)).toContain("webinars");
    expect(CARD_DEFINITIONS.video.sources?.(options).map((source) => source.source)).toContain("webinars");
  });
});

describe("Recordings > Booker Stock Club", () => {
  it("is a recordings room: admins post, members read; no replies; no live video, search or agents", () => {
    expect(isRecordingRoom("club-recordings")).toBe(true);
    expect(isAnnouncementRoom("club-recordings")).toBe(true);
    expect(roomRepliesOff("club-recordings")).toBe(true);
    expect(isStageRoom("club-recordings")).toBe(false);
    expect(allowedChatSearchRooms({ ...none, longboard: true, admin: true })).not.toContain("club-recordings");
  });
  it.each(people.slice(0, 6))("%s cannot post there", (_name, access) => {
    expect(canWriteChatRoom(access, "club-recordings", browser)).toBe(false);
    expect(canStartChatPost(access, "club-recordings", browser)).toBe(false);
  });
  it("an admin posts there", () => {
    expect(canWriteChatRoom({ ...none, longboard: true, admin: true }, "club-recordings", browser)).toBe(true);
  });
  it("holds the recordings of Webinars, and of Booker Stock Club's own webinars", () => {
    expect(stageRecordingRooms("club-recordings")).toEqual(["webinars", "club"]);
    expect(stageRecordingRooms("lb-recordings")).toEqual(["main"]);
    expect(stageRecordingRooms("ss-recordings")).toEqual(["shortscout"]);
    expect(stageRecordingRooms("social")).toEqual([]);
  });
  it("Longboard Bot may post in both new rooms (that is how the live notice's copy gets there)", () => {
    expect(ANNOUNCE_ROOMS).toContain("club-recordings");
    expect(ANNOUNCE_ROOMS).toContain("webinars");
  });
});

describe("Booker Stock Club is unchanged", () => {
  it.each(people.slice(0, 6))("%s still cannot post or reply in the club", (_name, access) => {
    expect(canAccessChatRoom(access, "club")).toBe(true);
    expect(canWriteChatRoom(access, "club", browser)).toBe(false);
    expect(canStartChatPost(access, "club", browser)).toBe(false);
  });
  it("only an admin in the browser posts there; never a token or an agent; no replies under a bot's post", () => {
    const admin = { ...none, longboard: true, admin: true };
    expect(canWriteChatRoom(admin, "club", browser)).toBe(true);
    expect(canWriteChatRoom(admin, "club", token)).toBe(false);
    expect(canWriteChatRoom(admin, "club", agent)).toBe(false);
    expect(canWriteChatRoom(admin, "club")).toBe(false);
    expect(messageRepliesOff("club", { bot_slug: "longboard" })).toBe(true);
    expect(messageRepliesOff("club", { bot_slug: "club" })).toBe(true);
  });
});
