import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), publish: vi.fn(), media: vi.fn() }));
vi.mock("@/lib/chatAdmin", () => ({ createChatAdminClient: () => ({ rpc: m.rpc, from: m.from }) }));
vi.mock("@/lib/chatAttachmentMedia", () => ({ withAttachmentMedia: m.media }));
vi.mock("ably", () => ({ Rest: class { channels = { get: () => ({ publish: m.publish }) }; } }));
import { readEvents } from "@/lib/chatReads/events";
import { publishRoomEvent } from "@/lib/chatRealtimePublish";
import type { ChatAuthResult } from "@/lib/chatAuth";

const auth = (admin = false, boardroom = true): ChatAuthResult => ({
  ok: true,
  user: { id: "acct", email: "", role: admin ? "admin" : "user" },
  access: { longboard: true, boardroom, shortscout: false, admin } as never,
  serverSession: false,
});
const read = (query: string, who = auth()) => readEvents(new NextRequest(`https://chat.test/api/chat/events?${query}`), who);
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CHAT_EVENT_STREAM", "all");
  m.media.mockImplementation(async (_db: unknown, _scope: unknown, rows: Array<Record<string, unknown>>) =>
    rows.map((r) => ((r.attachment_ids as string[])?.length ? { ...r, attachment_media: { x: { kind: "file" } } } : r)),
  );
});
afterEach(() => vi.unstubAllEnvs());

it("is off (404) unless CHAT_EVENT_STREAM lets this account in", async () => {
  vi.stubEnv("CHAT_EVENT_STREAM", "");
  expect((await read("room=social")).status).toBe(404);
  vi.stubEnv("CHAT_EVENT_STREAM", "admins");
  expect((await read("room=social")).status).toBe(404);
  m.rpc.mockResolvedValue({ data: { head: 3, rows: [], deleted: [] }, error: null });
  expect((await read("room=social", auth(true))).status).toBe(200);
});

it("checks the room, the cursor and sign-in", async () => {
  expect((await read("room=nope")).status).toBe(400);
  expect((await read("room=main", auth(false, false))).status).toBe(403);
  expect((await read("room=social&after=-1")).status).toBe(400);
  expect((await read("room=social&after=1e3")).status).toBe(400);
  expect((await read("room=social", { ok: false, status: 401, error: "unauthenticated" })).status).toBe(401);
  expect(m.rpc).not.toHaveBeenCalled();
});

it("without a cursor answers only the head", async () => {
  m.rpc.mockResolvedValue({ data: { head: 42, rows: [], deleted: [] }, error: null });
  const response = await read("room=social");
  expect(await response.json()).toEqual({ head: 42, complete: true, events: [] });
  expect(m.rpc).toHaveBeenCalledWith("chat_room_events_after", { p_room: "social", p_after: Number.MAX_SAFE_INTEGER, p_limit: 100 });
  expect(response.headers.get("cache-control")).toContain("no-store");
});

it("lists changed rows and deletions in order, display fields only, with image sizes", async () => {
  m.rpc.mockResolvedValue({
    data: {
      head: 9,
      rows: [
        { id: ID(1), body: "a", event_seq: 7, guest_id: "secret", client_id: "secret", attachment_ids: [] },
        { id: ID(2), body: "b", event_seq: 9, attachment_ids: [ID(5)] },
      ],
      deleted: [{ id: ID(3), event_seq: 8 }],
    },
    error: null,
  });
  const body = await (await read("room=social&after=6")).json();
  expect(m.rpc).toHaveBeenCalledWith("chat_room_events_after", { p_room: "social", p_after: 6, p_limit: 100 });
  expect(body.complete).toBe(true);
  expect(body.events.map((e: { seq: number }) => e.seq)).toEqual([7, 8, 9]);
  expect(body.events[0].row).toEqual({ id: ID(1), body: "a", event_seq: 7, attachment_ids: [] });
  expect(body.events[1]).toEqual({ seq: 8, deletedId: ID(3) });
  expect(body.events[2].row.attachment_media).toBeDefined();
});

it("says incomplete (and lists nothing) past the limit, and 503s on a database error", async () => {
  m.rpc.mockResolvedValueOnce({
    data: { head: 500, rows: Array.from({ length: 101 }, (_, i) => ({ id: ID(i), event_seq: i + 1 })), deleted: [] },
    error: null,
  });
  expect(await (await read("room=social&after=0")).json()).toEqual({ head: 500, complete: false, events: [] });
  m.rpc.mockResolvedValueOnce({ data: null, error: { message: "timeout" } });
  expect((await read("room=social&after=0")).status).toBe(503);
  // Before the migration: no such function, which reads as off.
  m.rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
  expect((await read("room=social&after=0")).status).toBe(404);
});

it("publishes the room head with edits and reload signals, never with a plain send, only while on", async () => {
  vi.stubEnv("CHAT_ABLY_API_KEY", "app.key:secret");
  vi.stubEnv("CHAT_ABLY_ROLLOUT", "all");
  const maybeSingle = vi.fn(async () => ({ data: { seq: 12 }, error: null }));
  m.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle }) }) });
  await publishRoomEvent("social", { kind: "message", eventType: "INSERT", row: { id: "m", event_seq: 12 } });
  expect(m.publish).toHaveBeenLastCalledWith("message", { kind: "message", eventType: "INSERT", row: { id: "m", event_seq: 12 } });
  await publishRoomEvent("social", { kind: "message", eventType: "UPDATE", row: { id: "m", event_seq: 11 } });
  expect(m.publish).toHaveBeenLastCalledWith("message", { kind: "message", eventType: "UPDATE", row: { id: "m", event_seq: 11 }, head: 12 });
  await publishRoomEvent("social", { kind: "changed", topics: ["history", "room"] });
  expect(m.publish).toHaveBeenLastCalledWith("changed", { kind: "changed", topics: ["history", "room"], head: 12 });
  await publishRoomEvent("social", { kind: "changed", topics: ["reactions"], messageId: "m" });
  expect(maybeSingle).toHaveBeenCalledTimes(2);
  maybeSingle.mockRejectedValueOnce(new Error("missing table"));
  await publishRoomEvent("social", { kind: "changed", topics: ["history"] });
  expect(m.publish).toHaveBeenLastCalledWith("changed", { kind: "changed", topics: ["history"] });
  vi.stubEnv("CHAT_EVENT_STREAM", "off");
  await publishRoomEvent("social", { kind: "changed", topics: ["history"] });
  expect(maybeSingle).toHaveBeenCalledTimes(3);
});
