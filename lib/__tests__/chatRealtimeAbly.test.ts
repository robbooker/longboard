import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ publish: vi.fn(), channel: vi.fn(), tokenRequest: vi.fn(), auth: vi.fn() }));
vi.mock("ably", () => ({
  Rest: class {
    channels = { get: (name: string) => (m.channel(name), { publish: m.publish }) };
    auth = { createTokenRequest: m.tokenRequest };
  },
}));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: m.auth }));
import { publishedRow, publishRoomEvent, publishRoomEventAfterResponse } from "@/lib/chatRealtimePublish";
import { chatRoomFromChannel } from "@/lib/chatRealtimeChannels";
import { GET } from "@/app/api/chat/realtime-token/route";

const user = (admin = false) => ({
  ok: true,
  user: { id: "acct", email: "", role: "user" },
  access: { longboard: true, boardroom: false, shortscout: false, admin },
  serverSession: false,
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ABLY_API_KEY", "app.key:secret");
  vi.stubEnv("CHAT_ABLY_ROLLOUT", "all");
  m.auth.mockResolvedValue(user());
  m.tokenRequest.mockImplementation(async (params: unknown) => ({ signed: true, params }));
});
afterEach(() => vi.unstubAllEnvs());

it("publishes display fields only, to the room's channel", async () => {
  await publishRoomEvent("social", {
    kind: "message",
    eventType: "INSERT",
    row: { id: "m1", body: "hi", client_id: "secret-retry-key", guest_id: "g", search_document: "x", unread_seq: 4 },
  });
  expect(m.channel).toHaveBeenCalledWith("private:chat:room:social");
  expect(m.publish).toHaveBeenCalledWith("message", { kind: "message", eventType: "INSERT", row: { id: "m1", body: "hi", unread_seq: 4 } });
  expect(publishedRow({ client_id: "x" })).toEqual({});
});

it("does nothing when rollout is off or no key is set, and never throws", async () => {
  vi.stubEnv("CHAT_ABLY_ROLLOUT", "off");
  await publishRoomEvent("main", { kind: "changed", topics: ["history"] });
  vi.stubEnv("CHAT_ABLY_ROLLOUT", "all");
  vi.stubEnv("ABLY_API_KEY", "");
  await publishRoomEvent("main", { kind: "changed", topics: ["history"] });
  expect(m.publish).not.toHaveBeenCalled();
  vi.stubEnv("ABLY_API_KEY", "app.key:secret");
  m.publish.mockRejectedValueOnce(new Error("ably down"));
  await expect(publishRoomEvent("main", { kind: "changed", topics: ["room"] })).resolves.toBeUndefined();
  // Outside a request scope after() throws; scheduling must still not fail the caller.
  expect(() => publishRoomEventAfterResponse("main", { kind: "changed", topics: ["room"] })).not.toThrow();
});

it("issues a subscribe-only token for exactly the rooms the account may read", async () => {
  const response = await GET(new NextRequest("https://chat.test/api/chat/realtime-token"));
  const body = await response.json();
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(body.params.clientId).toBe("chat:acct");
  expect(Object.values(body.params.capability).every((ops) => JSON.stringify(ops) === '["subscribe"]')).toBe(true);
  const rooms = Object.keys(body.params.capability).map(chatRoomFromChannel);
  expect(rooms).toContain("social");
  expect(rooms).not.toContain("main");
  expect(rooms).not.toContain("shortscout");
});

it("respects the rollout and authentication", async () => {
  vi.stubEnv("CHAT_ABLY_ROLLOUT", "admins");
  expect((await GET(new NextRequest("https://chat.test/x"))).status).toBe(404);
  m.auth.mockResolvedValue(user(true));
  expect((await GET(new NextRequest("https://chat.test/x"))).status).toBe(200);
  m.auth.mockResolvedValue({ ok: false, status: 401, error: "unauthenticated" });
  expect((await GET(new NextRequest("https://chat.test/x"))).status).toBe(401);
  expect(m.tokenRequest).toHaveBeenCalledTimes(1);
});

import { ablyRoomEventActions } from "@/lib/chatRealtimeChannels";
it("merges messages only for rooms on screen and refreshes threads only when needed", () => {
  const row = { id: "m1", body: "hi", reply_to_id: null };
  expect(ablyRoomEventActions("social", ["social"], "message", { kind: "message", eventType: "INSERT", row })).toEqual({
    detail: { eventType: "INSERT", new: row, old: {} },
    topics: ["activity"],
  });
  expect(
    ablyRoomEventActions("social", ["social"], "message", { kind: "message", eventType: "INSERT", row: { ...row, reply_to_id: "p" } }).topics,
  ).toEqual(["room", "activity"]);
  // Another room: just its unread counts.
  expect(ablyRoomEventActions("main", ["social"], "message", { kind: "message", eventType: "INSERT", row })).toEqual({ detail: null, topics: ["activity"] });
});

it("maps change signals to reload topics and ignores malformed events", () => {
  expect(ablyRoomEventActions("main", ["main"], "changed", { kind: "changed", topics: ["history", "bogus"] }).topics).toEqual(["history", "activity"]);
  expect(ablyRoomEventActions("main", ["social"], "changed", { kind: "changed", topics: ["status"] }).topics).toEqual(["activity"]);
  expect(ablyRoomEventActions("main", ["main"], "message", { kind: "message", row: {} })).toEqual({ detail: null, topics: [] });
  expect(ablyRoomEventActions("main", ["main"], "other", null)).toEqual({ detail: null, topics: [] });
});

import { chatAblyKey } from "@/lib/chatRealtimeChannels";
it("prefers the chat-only Ably key over the shared chart key", async () => {
  expect(chatAblyKey({ CHAT_ABLY_API_KEY: "chat.key:s", ABLY_API_KEY: "chart.key:s" })).toBe("chat.key:s");
  expect(chatAblyKey({ ABLY_API_KEY: "chart.key:s" })).toBe("chart.key:s");
  expect(chatAblyKey({ CHAT_ABLY_API_KEY: "" })).toBeUndefined();
});
