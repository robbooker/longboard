import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
// #330: with a bot account's token, every room but its own and every DM route is refused before any
// data is read; an ordinary member's answers don't change.
const m = vi.hoisted(() => ({ auth: vi.fn(), admin: vi.fn(), authorization: null as string | null, rpc: vi.fn() }));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: m.auth }));
vi.mock("@/lib/chatAdmin", () => ({
  createChatAdminClient: m.admin,
  requestOriginAllowed: () => true,
}));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: vi.fn(),
}));
import { allowedChatRooms, allowedChatSearchRooms, canAccessChatRoom, canUseDirectMessages, canWriteChatRoom } from "@/lib/chatAccess";
import { membershipLabels } from "@/lib/chatMemberships";
import { CHAT_ROOMS } from "@/lib/publicChat";
import { GET as history } from "@/app/api/chat/history/route";
import { GET as thread } from "@/app/api/chat/thread/route";
import { GET as threadCounts } from "@/app/api/chat/thread-counts/route";
import { GET as opening } from "@/app/api/chat/opening/route";
import { GET as pins } from "@/app/api/chat/message-pins/route";
import { GET as reactions } from "@/app/api/chat/reactions/route";
import { POST as messageReactions } from "@/app/api/chat/message-reactions/route";
import { POST as send } from "@/app/api/chat/route";
import { POST as message } from "@/app/api/chat/message/route";
import { GET as search } from "@/app/api/chat/search/route";
import { GET as searchContext } from "@/app/api/chat/search/context/route";
import { GET as roomMembers, POST as roomMembersPost } from "@/app/api/chat/room-members/route";
import { GET as dmMembers } from "@/app/api/chat/dm-members/route";
import { GET as inbox, POST as inboxPost } from "@/app/api/chat/inbox/route";
import { POST as member } from "@/app/api/chat/member/route";
import { GET as mentions } from "@/app/api/chat/mentions/route";
import { POST as updates } from "@/app/api/chat/updates/route";
import { attachmentAccess } from "@/lib/chatAttachments";

const account = "00000000-0000-4000-8000-000000000001";
const uuid = "00000000-0000-4000-8000-000000000002";
const bot = {
  ok: true,
  user: { id: account, email: "wren@bot.longboard.invalid", role: "user" },
  apiToken: true,
  serverSession: false,
  access: { longboard: false, boardroom: false, shortscout: false, shortscoutMember: false, admin: false, botRooms: ["developers"] },
};
const person = { longboard: true, boardroom: true, shortscout: false, shortscoutMember: false, admin: false };
const get = (path: string) => new NextRequest(`https://longboard.test${path}`);
const post = (path: string, body: unknown) =>
  new NextRequest(`https://longboard.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
// Any read of data fails the test: refusals must come first.
const untouched = () => {
  throw new Error("no database read should happen");
};
beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue(bot);
  m.admin.mockImplementation(untouched);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
});

describe("bot access rules", () => {
  it("allows only the listed rooms, and writing only there", () => {
    expect(allowedChatRooms(bot.access)).toEqual(["developers"]);
    expect(allowedChatSearchRooms(bot.access)).toEqual(["developers"]);
    for (const { slug } of CHAT_ROOMS) {
      expect(canAccessChatRoom(bot.access, slug)).toBe(slug === "developers");
      expect(canWriteChatRoom(bot.access, slug)).toBe(slug === "developers");
    }
    expect(canUseDirectMessages(bot.access)).toBe(false);
  });
  it("can't be widened by other flags", () => {
    const widened = { ...bot.access, admin: true, longboard: true, boardroom: true, shortscout: true };
    expect(allowedChatRooms(widened)).toEqual(["developers"]);
    expect(canWriteChatRoom(widened, "lb-announcements")).toBe(false);
  });
  it("fails closed on an empty or unknown list", () => {
    expect(allowedChatRooms({ ...bot.access, botRooms: [] })).toEqual([]);
    expect(allowedChatRooms({ ...bot.access, botRooms: ["nope"] })).toEqual([]);
  });
  it("leaves ordinary members exactly as they were", () => {
    expect(allowedChatRooms(person)).toEqual(["main", "social", "lb-announcements", "gainers", "lb-recordings", "whats-new", "developers","lb-review"]);
    expect(allowedChatRooms({ ...person, admin: true })).toEqual(CHAT_ROOMS.map((room) => room.slug));
    expect(canUseDirectMessages(person)).toBe(true);
    expect(canUseDirectMessages({ ...person, admin: true })).toBe(true);
  });
  it("adds the bot label without touching LB/SS", () => {
    expect(membershipLabels(["SS", "bot", "LB", "x"])).toEqual(["LB", "SS", "bot"]);
  });
});

describe("rooms other than Developers are refused", () => {
  const others = CHAT_ROOMS.map((room) => room.slug).filter((slug) => slug !== "developers");
  it.each(others)("%s", async (room) => {
    const calls: Array<[string, () => Promise<Response> | Response]> = [
      ["history", () => history(get(`/api/chat/history?room=${room}`))],
      ["thread", () => thread(get(`/api/chat/thread?room=${room}&messageId=${uuid}`))],
      ["thread-counts", () => threadCounts(get(`/api/chat/thread-counts?room=${room}&ids=${uuid}`))],
      ["opening", () => opening(get(`/api/chat/opening?room=${room}`))],
      ["pins", () => pins(get(`/api/chat/message-pins?room=${room}`))],
      ["reactions", () => reactions(get(`/api/chat/reactions?room=${room}&messageId=${uuid}`))],
      ["message-reactions", () => messageReactions(post("/api/chat/message-reactions", { kind: "room", room, action: "read", messageIds: [uuid] }))],
      ["send", () => send(post("/api/chat", { room, action: "send", body: "hi", clientId: uuid }))],
      ["edit", () => message(post("/api/chat/message", { room, messageId: uuid, action: "delete" }))],
      ["members", () => roomMembers(get(`/api/chat/room-members?room=${room}`))],
      ["member count", () => roomMembers(get(`/api/chat/room-members?room=${room}&summary=1`))],
      ["member names", () => roomMembersPost(post("/api/chat/room-members", { room, ids: [uuid] }))],
    ];
    for (const [name, call] of calls) {
      const response = await call();
      expect([name, response.status]).toEqual([name, 403]);
    }
  });
  it("leaves out the room when none is named (defaults to main)", async () => {
    expect((await history(get("/api/chat/history"))).status).toBe(403);
  });
});

describe("search covers Developers only", () => {
  it.each(["main", "social", "shortscout", "lb-social", "ss-social", "all"])("refuses scope %s", async (room) => {
    expect((await search(get(`/api/chat/search?q=hello&room=${room}`))).status).toBe(403);
  });
  it("refuses the default scope", async () => {
    expect((await search(get("/api/chat/search?q=hello"))).status).toBe(403);
  });
  it("searches Developers", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    m.admin.mockReturnValue({ rpc, from: () => ({ select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) }) });
    expect((await search(get("/api/chat/search?q=hello&room=developers"))).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("search_longboard_chat", expect.objectContaining({ p_room: "developers" }));
  });
  it("search context looks only in Developers", async () => {
    const within = vi.fn(() => ({ maybeSingle: async () => ({ data: null, error: null }) }));
    const chain = { select: () => chain, eq: () => chain, in: within };
    m.admin.mockReturnValue({ from: () => chain, rpc: untouched });
    const response = await searchContext(get(`/api/chat/search/context?id=${uuid}`));
    expect(await response.json()).toEqual({ messages: [] });
    expect(within).toHaveBeenCalledWith("room_slug", ["developers"]);
  });
});

describe("every DM route is refused", () => {
  it.each([
    ["inbox list", () => inbox(get("/api/chat/inbox"))],
    ["read a conversation", () => inbox(get(`/api/chat/inbox?conversation=${uuid}`))],
    ["room summaries", () => inbox(get("/api/chat/inbox?conversation=room-summaries"))],
    ["DM search", () => dmMembers(get("/api/chat/dm-members?q=Rob"))],
    ["opening", () => opening(get(`/api/chat/opening?conversation=${uuid}`))],
    ...["request", "send", "accept", "decline", "block", "unblock", "report", "read", "edit", "delete", "settings"].map(
      (action) =>
        [`inbox ${action}`, () => inboxPost(post("/api/chat/inbox", { action, target: uuid, body: "x", clientId: uuid, messageId: uuid, expectedRevision: 0, value: true }))] as [string, () => Promise<Response>],
    ),
  ] as Array<[string, () => Promise<Response>]>)("%s", async (_name, call) => {
    const response = await call();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "direct_messages_unavailable" });
  });
  it("DM reactions", async () => {
    expect((await messageReactions(post("/api/chat/message-reactions", { kind: "dm", conversationId: uuid, action: "read", messageIds: [uuid] }))).status).toBe(403);
  });
  it("files in DMs and other rooms", async () => {
    const memberRead = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: uuid, display_name: "Wren" }, error: null }) }) }) }) };
    const db = memberRead as unknown as Parameters<typeof attachmentAccess>[0];
    const auth = bot as unknown as Parameters<typeof attachmentAccess>[1];
    await expect(attachmentAccess(db, auth, { conversation_id: uuid })).rejects.toMatchObject({ status: 404 });
    await expect(attachmentAccess(db, auth, { room_slug: "social" })).rejects.toMatchObject({ status: 404 });
  });
});

describe("other routes", () => {
  it("can't rename itself", async () => {
    expect((await member(post("/api/chat/member", { action: "rename", displayName: "Rob" }))).status).toBe(403);
  });
  it("a batch read refuses the same paths and reports only Developers", async () => {
    m.admin.mockReturnValue({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: uuid, display_name: "Wren", accepts_requests: false }, error: null }) }) }) }) });
    const response = await updates(post("/api/chat/updates", { paths: ["/api/chat/inbox", "/api/chat/history?room=social", "/api/chat?room=main"] }));
    const body = await response.json();
    expect(body.access.rooms).toEqual(["developers"]);
    expect(body.access.canLinkShortScout).toBe(false);
    expect(body.results.map((row: { status: number }) => row.status)).toEqual([403, 403, 403]);
  });
});

describe("mention suggestions", () => {
  const setup = () => {
    const not = vi.fn();
    const query = { not, order: () => ({ limit: async () => ({ data: [], error: null }) }) };
    not.mockReturnValue(query);
    const from = vi.fn((table: string) =>
      table === "chat_bot_accounts"
        ? { select: async () => ({ data: [{ account_id: account, allowed_rooms: ["developers"] }], error: null }) }
        : table === "longboard_chat_members"
          ? { select: () => ({ ilike: () => query, eq: () => ({ maybeSingle: async () => ({ data: { id: uuid, display_name: "Ann" }, error: null }) }) }) }
          : untouched(),
    );
    m.admin.mockReturnValue({ from });
    m.auth.mockResolvedValue({ ...bot, access: person });
    return not;
  };
  it("offers a bot in its room", async () => {
    const not = setup();
    expect((await mentions(get("/api/chat/mentions?q=Wr&room=developers"))).status).toBe(200);
    expect(not).not.toHaveBeenCalled();
  });
  it.each(["/api/chat/mentions?q=Wr&room=social", "/api/chat/mentions?q=Wr"])("hides it elsewhere: %s", async (path) => {
    const not = setup();
    expect((await mentions(get(path))).status).toBe(200);
    expect(not).toHaveBeenCalledWith("user_id", "in", `(${account})`);
  });
});
