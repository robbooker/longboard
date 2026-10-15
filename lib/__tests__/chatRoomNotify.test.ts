import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  parseRoomNotifyLevel,
  roomBadgeCounts,
  roomNotifyAvailable,
  roomNotifyLevel,
} from "@/lib/chatRoomNotify";
import { emptyChatActivity } from "@/lib/chatActivity";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), from: vi.fn(), origin: vi.fn() }));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: mocks.auth }));
vi.mock("@/lib/chatAdmin", () => ({
  createChatAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }),
  requestOriginAllowed: mocks.origin,
}));
import { GET, POST } from "@/app/api/chat/activity/route";
import { forgetRecentActivity } from "@/lib/chatReads/activity";

describe("room notification levels", () => {
  it("parses only the three levels and defaults to all", () => {
    expect(["all", "mentions", "muted"].map(parseRoomNotifyLevel)).toEqual(["all", "mentions", "muted"]);
    for (const bad of ["", "MUTED", "none", null, undefined, 1, {}]) expect(parseRoomNotifyLevel(bad)).toBeNull();
    expect(roomNotifyLevel(undefined, "main")).toBe("all");
    expect(roomNotifyLevel({ social: "muted" }, "main")).toBe("all");
    expect(roomNotifyLevel({ social: "muted" }, "social")).toBe("muted");
    expect(roomNotifyLevel({ social: "loud" as never }, "social")).toBe("all");
  });
  it("is offered only when the server reports levels (after the migration)", () => {
    expect(roomNotifyAvailable(emptyChatActivity)).toBe(false);
    expect(roomNotifyAvailable({ roomLevels: {} })).toBe(true);
    expect(roomNotifyAvailable({ roomLevels: [] })).toBe(false);
    expect(roomNotifyAvailable({ roomLevels: null })).toBe(false);
  });
  it("badges every message on all, only mentions on mentions-only, nothing when muted", () => {
    const counts = { main: 5, social: 4, shortscout: 3, "lb-announcements": 2 };
    const data = { roomMessageCounts: counts, roomCounts: { social: 1, "lb-announcements": 2 } };
    // No saved levels (or only "all"): the server's map, same reference (no re-render churn).
    expect(roomBadgeCounts(data)).toBe(counts);
    expect(roomBadgeCounts({ ...data, roomLevels: { main: "all" } })).toBe(counts);
    expect(
      roomBadgeCounts({ ...data, roomLevels: { main: "muted", social: "mentions", shortscout: "mentions" } }),
    ).toEqual({ main: 0, social: 1, shortscout: 0, "lb-announcements": 2 });
    expect(counts.main).toBe(5);
  });
});

describe("POST /api/chat/activity roomLevel", () => {
  const id = "10000000-0000-4000-8000-000000000001";
  const req = (body: unknown) =>
    new NextRequest("https://example.test/api/chat/activity", { method: "POST", body: JSON.stringify(body) });
  const table = { upsert: vi.fn(), delete: vi.fn(), eq: vi.fn() };
  beforeEach(() => {
    vi.clearAllMocks();
    forgetRecentActivity(id);
    mocks.origin.mockReturnValue(true);
    mocks.auth.mockResolvedValue({
      ok: true,
      user: { id },
      access: { longboard: true, boardroom: true, shortscout: false, admin: false },
    });
    mocks.rpc.mockResolvedValue({ data: { mentionCount: 0, dmCount: 0 }, error: null });
    table.upsert.mockResolvedValue({ error: null });
    table.delete.mockReturnValue(table);
    let eqs = 0;
    table.eq.mockImplementation(() => (++eqs % 2 ? table : Promise.resolve({ error: null })));
    mocks.from.mockReturnValue(table);
  });
  it("saves mentions/muted for the signed-in account and removes the row for all", async () => {
    expect((await POST(req({ kind: "roomLevel", room: "social", level: "muted", account_id: "forged" }))).status).toBe(200);
    expect(mocks.from).toHaveBeenCalledWith("chat_room_notification_levels");
    expect(table.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ account_id: id, room_slug: "social", level: "muted" }),
      { onConflict: "account_id,room_slug" },
    );
    expect((await POST(req({ kind: "roomLevel", room: "main", level: "all" }))).status).toBe(200);
    expect(table.delete).toHaveBeenCalled();
    expect(table.eq).toHaveBeenCalledWith("account_id", id);
    expect(table.eq).toHaveBeenCalledWith("room_slug", "main");
  });
  it("rejects bad levels, unknown rooms and rooms the account cannot open", async () => {
    for (const body of [
      { room: "main", level: "loud" },
      { room: "nope", level: "muted" },
      { level: "muted" },
      { room: "main" },
    ])
      expect((await POST(req({ kind: "roomLevel", ...body }))).status).toBe(400);
    expect((await POST(req({ kind: "roomLevel", room: "shortscout", level: "muted" }))).status).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("reports a missing table (migration not applied) as unavailable, not success", async () => {
    table.upsert.mockResolvedValue({ error: { message: 'relation "chat_room_notification_levels" does not exist' } });
    expect((await POST(req({ kind: "roomLevel", room: "social", level: "mentions" }))).status).toBe(503);
  });
  it("drops the cached bell after a change so the next read shows the new level", async () => {
    await GET(new NextRequest("https://example.test/api/chat/activity"));
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    await POST(req({ kind: "roomLevel", room: "social", level: "muted" }));
    await GET(new NextRequest("https://example.test/api/chat/activity"));
    expect(mocks.rpc).toHaveBeenCalledTimes(4);
  });
});
