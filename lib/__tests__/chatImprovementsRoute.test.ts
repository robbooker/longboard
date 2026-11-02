import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { chatApiRouteAllowed } from "@/lib/chatApiToken";
import { IMPROVEMENT_MAX, parseImprovementSuggestion } from "@/lib/chatImprovements";

// #352: sender and time come from the session and the database, only someone who can open What's New
// may send, API tokens and bots can't, and nothing from the Admins room comes back.
const mock = vi.hoisted(() => ({ auth: vi.fn(), admin: vi.fn(), origin: vi.fn(), member: vi.fn(), publish: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: mock.auth }));
vi.mock("@/lib/chatAdmin", () => ({ createChatAdminClient: mock.admin, requestOriginAllowed: mock.origin }));
vi.mock("@/lib/chatMembers", () => ({ findChatMember: mock.member }));
vi.mock("@/lib/chatRealtimePublish", () => ({ publishRoomEventAfterResponse: mock.publish }));

import { POST } from "@/app/api/chat/improvement-suggestions/route";

const ME = "11111111-1111-4111-8111-111111111111";
const signedIn = (access: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({ ok: true, user: { id: "user-1", email: "", role: "user" }, access: { longboard: true, shortscout: false, admin: false, ...access }, serverSession: false, ...extra });
const send = (body: unknown) => POST(new NextRequest("https://chat.robbooker.com/api/chat/improvement-suggestions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  mock.auth.mockResolvedValue(signedIn());
  mock.origin.mockReturnValue(true);
  mock.member.mockResolvedValue({ id: ME, display_name: "Me" });
  mock.rpc.mockResolvedValue({ data: { posted: true, messageId: "secret-id" }, error: null });
  mock.admin.mockReturnValue({ rpc: mock.rpc });
});

describe("who may send", () => {
  it("posts for a member and tells Admins, returning nothing from that room", async () => {
    const response = await send({ suggestion: "A better bell" });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true });
    expect(mock.rpc).toHaveBeenCalledWith("post_chat_improvement_suggestion", { p_member: ME, p_text: "A better bell" });
    expect(mock.publish).toHaveBeenCalledWith("admins", { kind: "changed", topics: ["history"] });
    expect(mock.publish).toHaveBeenCalledTimes(1);
  });
  it("lets an admin and a ShortScout-only member send", async () => {
    mock.auth.mockResolvedValue(signedIn({ admin: true }));
    expect((await send({ suggestion: "x" })).status).toBe(201);
    mock.auth.mockResolvedValue(signedIn({ longboard: false, shortscoutMember: true }));
    expect((await send({ suggestion: "x" })).status).toBe(201);
  });
  it("ignores a sender and time in the request", async () => {
    await send({ suggestion: "Mine", member: "someone-else", p_member: "someone-else", memberId: "someone-else", name: "Rob", createdAt: "2001-01-01", room: "social" });
    expect(mock.rpc).toHaveBeenCalledWith("post_chat_improvement_suggestion", { p_member: ME, p_text: "Mine" });
  });
  it("refuses the signed out", async () => {
    mock.auth.mockResolvedValue({ ok: false, status: 401, error: "unauthenticated" });
    expect((await send({ suggestion: "x" })).status).toBe(401);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("refuses an account that can't open What's New", async () => {
    mock.auth.mockResolvedValue(signedIn({ longboard: false }));
    expect((await send({ suggestion: "x" })).status).toBe(403);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("refuses an API token, and a bot even with What's New on its list", async () => {
    mock.auth.mockResolvedValue(signedIn({}, { apiToken: true }));
    expect((await send({ suggestion: "x" })).status).toBe(403);
    mock.auth.mockResolvedValue(signedIn({ longboard: false, botRooms: ["whats-new"] }, { apiToken: true }));
    expect((await send({ suggestion: "x" })).status).toBe(403);
    expect(chatApiRouteAllowed("/api/chat/improvement-suggestions")).toBe(false);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("refuses another site, and a member with no chat name", async () => {
    mock.origin.mockReturnValue(false);
    expect((await send({ suggestion: "x" })).status).toBe(403);
    mock.origin.mockReturnValue(true);
    mock.member.mockResolvedValue(null);
    expect((await send({ suggestion: "x" })).status).toBe(403);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
});

describe("what happens when it can't post", () => {
  it("says so when rate limited", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { message: "improvement_suggestion_rate_limited" } });
    expect((await send({ suggestion: "x" })).status).toBe(429);
    expect(mock.publish).not.toHaveBeenCalled();
  });
  it("says unavailable before the migration", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { message: "function does not exist" } });
    const response = await send({ suggestion: "x" });
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("function");
  });
  it("refuses empty and too long without posting", async () => {
    expect((await send({ suggestion: " \n " })).status).toBe(400);
    expect((await send({ suggestion: "x".repeat(IMPROVEMENT_MAX + 1) })).status).toBe(400);
    expect((await send({})).status).toBe(400);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
});

describe("the text", () => {
  it("keeps their exact words and line breaks", () => {
    const words = "<b>Hi</b> @admins https://x.test\nsecond line **bold**";
    expect(parseImprovementSuggestion({ suggestion: `  ${words}\r\n` })).toEqual({ ok: true, value: words });
  });
  it("drops only what can't be seen", () => {
    expect(parseImprovementSuggestion({ suggestion: "a\u0000b‮c\n\n\n\nd" })).toEqual({ ok: true, value: "abc\n\nd" });
  });
  it("takes exactly the limit and refuses anything but text", () => {
    expect(parseImprovementSuggestion({ suggestion: "x".repeat(IMPROVEMENT_MAX) }).ok).toBe(true);
    expect(parseImprovementSuggestion({ suggestion: 5 }).ok).toBe(false);
    expect(parseImprovementSuggestion(null).ok).toBe(false);
  });
});
