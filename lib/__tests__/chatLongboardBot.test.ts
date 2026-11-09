// #413 Longboard Bot: the announce route's admin check and validation, the per-room ids that make a
// retry post nothing, and what "all" covers. No real service.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ChatAuthResult } from "@/lib/chatAuth";
import {
  ANNOUNCE_ROOMS,
  announcementClientId,
  announcementMessageId,
  parseAnnouncementRequest,
  postAnnouncement,
} from "@/lib/chatLongboardBot";
import { CHAT_ROOMS, isReservedChatName } from "@/lib/publicChat";

const publish = vi.fn();
vi.mock("@/lib/chatRealtimePublish", () => ({ publishRoomEventAfterResponse: (...a: unknown[]) => publish(...a) }));
// A fake database with the function's behaviour: one row per id, a retry answers duplicate.
const rows = new Map<string, { room: string; body: string }>();
let failRoom: string | null = null;
const rpc = vi.fn(async (name: string, args: { p_id: string; p_room: string; p_body: string }) => {
  if (name !== "post_chat_longboard_announcement") return { data: null, error: { message: "unknown" } };
  if (args.p_room === failRoom) return { data: null, error: { message: "longboard_chat_paused" } };
  if (rows.has(args.p_id)) return { data: { posted: false, reason: "duplicate", messageId: args.p_id }, error: null };
  rows.set(args.p_id, { room: args.p_room, body: args.p_body });
  return { data: { posted: true, messageId: args.p_id }, error: null };
});
const db = { rpc };
let dbAvailable = true;
let originAllowed = true;
vi.mock("@/lib/chatAdmin", () => ({
  createChatAdminClient: () => (dbAvailable ? db : null),
  requestOriginAllowed: () => originAllowed,
}));
let auth: ChatAuthResult = { ok: false, status: 401, error: "unauthenticated" };
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: async () => auth }));

const person = (role: "user" | "admin", extra: Record<string, unknown> = {}) =>
  ({ ok: true, user: { id: "u1", role }, access: { longboard: true, shortscout: false, admin: role === "admin" }, ...extra }) as unknown as ChatAuthResult;
const CLIENT = "11111111-2222-4333-8444-555555555555";

async function call(payload: unknown, raw?: string) {
  const { POST } = await import("@/app/api/chat/admin/announce/route");
  return POST(
    new NextRequest("http://x/api/chat/admin/announce", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw ?? JSON.stringify(payload),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  rows.clear();
  failRoom = null;
  dbAvailable = true;
  originAllowed = true;
  auth = person("admin");
});

describe("what all covers", () => {
  it("is every room except Gainers, in room order", () => {
    expect(ANNOUNCE_ROOMS).toEqual(CHAT_ROOMS.map((room) => room.slug).filter((slug) => slug !== "gainers"));
    expect(ANNOUNCE_ROOMS).toHaveLength(13);
  });
});

describe("parseAnnouncementRequest", () => {
  it("takes all, or a list of rooms (ordered, no repeats)", () => {
    expect(parseAnnouncementRequest({ rooms: "all", body: " Hi " })).toMatchObject({ ok: true, value: { rooms: ANNOUNCE_ROOMS, body: "Hi" } });
    expect(parseAnnouncementRequest({ rooms: ["social", "main", "social"], body: "Hi" })).toMatchObject({ ok: true, value: { rooms: ["main", "social"] } });
  });
  it("refuses bad input", () => {
    expect(parseAnnouncementRequest(null)).toEqual({ ok: false, error: "invalid_request" });
    expect(parseAnnouncementRequest({ rooms: "all" })).toEqual({ ok: false, error: "body_required" });
    expect(parseAnnouncementRequest({ rooms: "all", body: "   " })).toEqual({ ok: false, error: "body_required" });
    expect(parseAnnouncementRequest({ rooms: "all", body: "x".repeat(4001) })).toEqual({ ok: false, error: "body_too_long" });
    expect(parseAnnouncementRequest({ rooms: "all", body: "x".repeat(4000) }).ok).toBe(true);
    expect(parseAnnouncementRequest({ rooms: [], body: "Hi" })).toEqual({ ok: false, error: "invalid_rooms" });
    expect(parseAnnouncementRequest({ rooms: "main", body: "Hi" })).toEqual({ ok: false, error: "invalid_rooms" });
    expect(parseAnnouncementRequest({ rooms: ["nope"], body: "Hi" })).toEqual({ ok: false, error: "invalid_room" });
    expect(parseAnnouncementRequest({ rooms: ["gainers"], body: "Hi" })).toEqual({ ok: false, error: "room_not_allowed" });
    expect(parseAnnouncementRequest({ rooms: "all", body: "Hi", clientId: "abc" })).toEqual({ ok: false, error: "invalid_client_id" });
  });
  it("names the announcement by its clientId, or by its text", () => {
    expect(parseAnnouncementRequest({ rooms: "all", body: "Hi", clientId: CLIENT.toUpperCase() })).toMatchObject({ value: { clientId: CLIENT } });
    const a = parseAnnouncementRequest({ rooms: "all", body: "Hi" });
    const b = parseAnnouncementRequest({ rooms: "all", body: "  Hi" });
    expect(a.ok && b.ok && a.value.clientId === b.value.clientId).toBe(true);
    expect(announcementClientId("Hi")).not.toBe(announcementClientId("Hello"));
  });
});

describe("per-room ids", () => {
  it("are stable UUIDs, one per room", () => {
    const ids = ANNOUNCE_ROOMS.map((room) => announcementMessageId(CLIENT, room));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(announcementMessageId(CLIENT, "main")).toBe(announcementMessageId(CLIENT.toUpperCase(), "main"));
    expect(announcementMessageId(CLIENT, "main")).not.toBe(announcementMessageId("22222222-2222-4333-8444-555555555555", "main"));
  });
  it("a failing room doesn't stop the rest", async () => {
    failRoom = "social";
    const results = await postAnnouncement(db as never, { rooms: ["main", "social", "admins"], body: "Hi", clientId: CLIENT });
    expect(results.map((r) => [r.room, r.status, r.error])).toEqual([
      ["main", "posted", undefined],
      ["social", "failed", "room_paused"],
      ["admins", "posted", undefined],
    ]);
  });
});

describe("POST /api/chat/admin/announce", () => {
  it("signed out, members, and API tokens (bots included) are refused", async () => {
    auth = { ok: false, status: 401, error: "unauthenticated" };
    expect((await call({ rooms: "all", body: "Hi" })).status).toBe(401);
    auth = person("user");
    expect((await call({ rooms: "all", body: "Hi" })).status).toBe(403);
    auth = person("admin", { apiToken: true });
    expect((await call({ rooms: "all", body: "Hi" })).status).toBe(403);
    auth = { ok: true, user: { id: "b1", role: "user" }, access: { admin: false, botRooms: ["main"] }, apiToken: true } as unknown as ChatAuthResult;
    expect((await call({ rooms: "all", body: "Hi" })).status).toBe(403);
    // An admin role without the admin entitlement is not an admin.
    auth = { ok: true, user: { id: "u1", role: "admin" }, access: { admin: false } } as unknown as ChatAuthResult;
    expect((await call({ rooms: "all", body: "Hi" })).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses another site's form", async () => {
    originAllowed = false;
    expect((await call({ rooms: "all", body: "Hi" })).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("validates", async () => {
    expect((await call(null, "{nope")).status).toBe(400);
    expect(await (await call({ rooms: "all", body: "" })).json()).toEqual({ error: "body_required" });
    expect(await (await call({ rooms: "all", body: "x".repeat(4001) })).json()).toEqual({ error: "body_too_long" });
    expect(await (await call({ rooms: ["gainers"], body: "Hi" })).json()).toEqual({ error: "room_not_allowed" });
    expect((await call(null, "x".repeat(40000))).status).toBe(413);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("posts as Longboard Bot in every room of all, and tells each room", async () => {
    const response = await call({ rooms: "all", body: "Profile pictures are here.", clientId: CLIENT });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.clientId).toBe(CLIENT);
    expect(json.results.map((r: { room: string }) => r.room)).toEqual(ANNOUNCE_ROOMS);
    expect(json.results.every((r: { status: string }) => r.status === "posted")).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(ANNOUNCE_ROOMS.length);
    expect(rpc).toHaveBeenCalledWith("post_chat_longboard_announcement", {
      p_id: announcementMessageId(CLIENT, "main"),
      p_room: "main",
      p_body: "Profile pictures are here.",
    });
    expect(publish).toHaveBeenCalledTimes(ANNOUNCE_ROOMS.length);
    expect(publish).toHaveBeenCalledWith("admins", { kind: "changed", topics: ["history"] });
  });
  it("a retry posts nothing new", async () => {
    await call({ rooms: ["main", "social"], body: "Hi", clientId: CLIENT });
    publish.mockClear();
    const json = await (await call({ rooms: ["main", "social"], body: "Hi", clientId: CLIENT })).json();
    expect(json.results.map((r: { status: string }) => r.status)).toEqual(["duplicate", "duplicate"]);
    expect(rows.size).toBe(2);
    expect(publish).not.toHaveBeenCalled();
    // Without a clientId the same words are the same announcement.
    await call({ rooms: ["main"], body: "Same words" });
    const again = await (await call({ rooms: ["main"], body: "Same words" })).json();
    expect(again.results[0].status).toBe("duplicate");
  });
  it("answers 207 when a room failed, naming it", async () => {
    failRoom = "social";
    const response = await call({ rooms: ["main", "social"], body: "Hi", clientId: CLIENT });
    expect(response.status).toBe(207);
    expect((await response.json()).results[1]).toMatchObject({ room: "social", status: "failed", error: "room_paused" });
  });
  it("503 without the database", async () => {
    dbAvailable = false;
    expect((await call({ rooms: "all", body: "Hi" })).status).toBe(503);
  });
});

describe("the bot's name", () => {
  it("is reserved for members", () => {
    expect(isReservedChatName("Longboard Bot")).toBe(true);
    expect(isReservedChatName("  longboard   BOT ")).toBe(true);
  });
});
