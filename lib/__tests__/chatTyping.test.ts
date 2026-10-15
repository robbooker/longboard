import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  chatRealtimeCapability,
  chatTypingClientId,
  chatTypingDmChannel,
  chatTypingRoomChannel,
  createTypingThrottle,
  expireTyping,
  memberIdFromClientId,
  noteTyping,
  typingLabel,
  typingNames,
  type TypingRoster,
} from "@/lib/chatTyping";
import { chatRoomFromChannel } from "@/lib/chatRealtimeChannels";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const SELF = "44444444-4444-4444-8444-444444444444";

describe("typing labels", () => {
  it("names one, two, then several", () => {
    expect(typingLabel([])).toBe("");
    expect(typingLabel(["Bob"])).toBe("Bob is typing…");
    expect(typingLabel(["Bob", "Alice"])).toBe("Bob and Alice are typing…");
    expect(typingLabel(["Bob", "Alice", "Cy"])).toBe("Several people are typing…");
  });

  it("uses only member-list names, never yourself, never unknown ids", () => {
    const roster: TypingRoster = new Map();
    noteTyping(roster, A, 0);
    noteTyping(roster, SELF, 0);
    noteTyping(roster, C, 0);
    const list = new Map([
      [A, "Bob"],
      [SELF, "Me"],
    ]);
    // C is not resolvable (not in the list, e.g. blocked): hidden rather than guessed.
    expect(typingNames(roster, SELF.toUpperCase(), (id) => list.get(id))).toEqual(["Bob"]);
  });

  it("orders by latest signal", () => {
    const roster: TypingRoster = new Map();
    noteTyping(roster, A, 0);
    noteTyping(roster, B, 1);
    noteTyping(roster, A, 2);
    expect([...roster.keys()]).toEqual([B, A]);
  });
});

describe("expiry", () => {
  it("drops a typer 6 s after their last signal and reports the next expiry", () => {
    const roster: TypingRoster = new Map();
    noteTyping(roster, A, 1000);
    noteTyping(roster, B, 4000);
    expect(expireTyping(roster, 5000)).toBe(7000);
    expect(expireTyping(roster, 7000)).toBe(10000);
    expect([...roster.keys()]).toEqual([B]);
    noteTyping(roster, B, 9000); // a fresh signal extends it
    expect(expireTyping(roster, 10000)).toBe(15000);
    expect(expireTyping(roster, 15000)).toBeNull();
    expect(roster.size).toBe(0);
  });
});

describe("rate limit", () => {
  it("sends at most once per 3 s", () => {
    const throttle = createTypingThrottle();
    const sent = [0, 500, 2999, 3000, 3100, 5999, 6000, 9500].filter((t) => throttle.shouldSend(t));
    expect(sent).toEqual([0, 3000, 6000, 9500]);
    throttle.reset();
    expect(throttle.shouldSend(9600)).toBe(true);
  });
});

describe("sender identity", () => {
  it("maps a pinned clientId back to a member id and rejects anything else", () => {
    expect(memberIdFromClientId(chatTypingClientId(A.toUpperCase()))).toBe(A);
    expect(memberIdFromClientId(`chat:${A}`)).toBeNull(); // an account id token
    expect(memberIdFromClientId("chat:m:not-a-uuid")).toBeNull();
    expect(memberIdFromClientId(undefined)).toBeNull();
  });
});

describe("capability", () => {
  it("keeps rooms subscribe-only and grants typing publish only where the member can post", () => {
    const capability = chatRealtimeCapability({
      rooms: ["social", "gainers"],
      writableRooms: ["social"],
      conversations: [A, "bogus"],
      typing: true,
    });
    expect(capability).toEqual({
      "private:chat:room:social": ["subscribe"],
      "private:chat:room:social.typing": ["publish", "subscribe"],
      "private:chat:room:gainers": ["subscribe"],
      "private:chat:room:gainers.typing": ["subscribe"],
      [chatTypingDmChannel(A)]: ["publish", "subscribe"],
    });
    expect(chatRealtimeCapability({ rooms: ["social"], writableRooms: ["social"], conversations: [A], typing: false })).toEqual({
      "private:chat:room:social": ["subscribe"],
    });
  });

  it("never reads a typing channel as a room", () => {
    expect(chatRoomFromChannel(chatTypingRoomChannel("social"))).toBeNull();
    expect(chatRoomFromChannel(chatTypingDmChannel(A))).toBeNull();
    expect(chatRoomFromChannel("private:chat:room:social")).toBe("social");
    // Every channel name stays one segment under the chat key's `private:chat:room:*`.
    expect(chatTypingDmChannel(A).slice("private:chat:room:".length)).not.toContain(":");
  });
});

const m = vi.hoisted(() => ({ tokenRequest: vi.fn(), auth: vi.fn(), grants: vi.fn() }));
vi.mock("ably", () => ({ Rest: class { auth = { createTokenRequest: m.tokenRequest }; } }));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: m.auth }));
vi.mock("@/lib/chatAdmin", () => ({ createChatAdminClient: () => ({}) }));
vi.mock("@/lib/chatTypingGrants", () => ({ chatTypingGrants: m.grants }));
const { GET } = await import("@/app/api/chat/realtime-token/route");

describe("realtime token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ABLY_API_KEY", "app.key:secret");
    vi.stubEnv("CHAT_ABLY_ROLLOUT", "all");
    m.auth.mockResolvedValue({
      ok: true,
      user: { id: "acct", email: "", role: "user" },
      access: { longboard: true, boardroom: false, shortscout: false, admin: false },
      serverSession: false,
    });
    m.grants.mockResolvedValue({ memberId: A, conversations: [B] });
    m.tokenRequest.mockImplementation(async (params: unknown) => ({ params }));
  });
  afterEach(() => vi.unstubAllEnvs());
  const token = async () => (await (await GET(new NextRequest("https://chat.test/api/chat/realtime-token"))).json()).params;

  it("pins the sender to the member and grants typing where they may post", async () => {
    const params = await token();
    expect(m.grants).toHaveBeenCalledWith({}, "acct");
    expect(params.clientId).toBe(`chat:m:${A}`);
    expect(params.capability["private:chat:room:social"]).toEqual(["subscribe"]);
    expect(params.capability["private:chat:room:social.typing"]).toEqual(["publish", "subscribe"]);
    expect(params.capability["private:chat:room:gainers.typing"]).toEqual(["subscribe"]);
    expect(params.capability[chatTypingDmChannel(B)]).toEqual(["publish", "subscribe"]);
    expect(params.capability["private:chat:room:main.typing"]).toBeUndefined();
  });

  it("carries no typing rights without a member, or with CHAT_TYPING=off", async () => {
    m.grants.mockResolvedValue({ memberId: null, conversations: [] });
    let params = await token();
    expect(params.clientId).toBe("chat:acct");
    expect(Object.values(params.capability).every((ops) => JSON.stringify(ops) === '["subscribe"]')).toBe(true);
    expect(Object.keys(params.capability).some((name) => name.includes("typing"))).toBe(false);
    m.grants.mockResolvedValue({ memberId: A, conversations: [B] });
    vi.stubEnv("CHAT_TYPING", "off");
    params = await token();
    expect(Object.keys(params.capability).some((name) => name.includes("typing"))).toBe(false);
    expect(m.grants).toHaveBeenCalledTimes(1);
  });
});

import { chatTypingGrants } from "@/lib/chatTypingGrants";
const realGrants = (await vi.importActual<typeof import("@/lib/chatTypingGrants")>("@/lib/chatTypingGrants"))
  .chatTypingGrants as typeof chatTypingGrants;
describe("DM grants", () => {
  const admin = (tables: Record<string, { data?: unknown; error?: unknown }>) => ({
    from(table: string) {
      const result = table === "longboard_chat_members" ? { data: { id: A }, error: null } : tables[table];
      const chain: Record<string, unknown> = {};
      for (const key of ["select", "eq", "or", "order", "limit"]) chain[key] = () => chain;
      chain.maybeSingle = async () => result;
      chain.then = (resolve: (value: unknown) => unknown) => resolve(result);
      return chain;
    },
  });
  it("lists accepted DMs minus blocked people, and fails closed", async () => {
    const conversations = {
      data: [
        { id: B, requester_id: A, recipient_id: C },
        { id: SELF, requester_id: SELF, recipient_id: A },
      ],
      error: null,
    };
    const blocks = { data: [{ blocker_id: SELF, blocked_id: A }], error: null };
    expect(
      await realGrants(admin({ longboard_chat_conversations: conversations, longboard_chat_blocks: blocks }) as never, "acct"),
    ).toEqual({ memberId: A, conversations: [B] });
    expect(
      await realGrants(
        admin({ longboard_chat_conversations: conversations, longboard_chat_blocks: { error: { message: "x" } } }) as never,
        "acct",
      ),
    ).toEqual({ memberId: null, conversations: [] });
  });
});
