// #535: when a broadcast in Booker Stock Club is marked ended (the moment its chat locks), every
// page showing the club is told to ask the room's status again; other rooms get only the reload.
import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const publish = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/chatRealtimePublish", () => ({ publishRoomEvent: publish, publishRoomEventAfterResponse: vi.fn() }));
import { stageNoticeStore } from "@/lib/chatStageNotifyServer";

const rpc = vi.fn();
const store = () => stageNoticeStore({ rpc } as unknown as SupabaseClient);
beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: true, error: null });
});

it("the club: the lock is signalled with the reload", async () => {
  expect(await store().close("club", "notice", "ended", Date.now())).toBe(true);
  expect(publish.mock.calls).toEqual([
    ["club", { kind: "changed", topics: ["history"] }],
    ["club", { kind: "changed", topics: ["stage"] }],
  ]);
});
it("another room: only the reload, as before", async () => {
  expect(await store().close("main", "notice", "ended", Date.now())).toBe(true);
  expect(publish.mock.calls).toEqual([["main", { kind: "changed", topics: ["history"] }]]);
});
it("a close that marked nothing (another server already had) signals nothing", async () => {
  rpc.mockResolvedValue({ data: false, error: null });
  expect(await store().close("club", "notice", "ended", Date.now())).toBe(false);
  expect(publish).not.toHaveBeenCalled();
});
