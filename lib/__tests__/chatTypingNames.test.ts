import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetRoomMemberNames, roomMemberName } from "@/components/chat/room/useTyping";

// HEALTH-2026-10-17-1: naming a typer must not read the whole member list, and a failed lookup
// must not be retried on every typing signal (that loop drove /api/chat/room-members into 503s).
const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const fetchMock = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  resetRoomMemberNames();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const ok = (members: Array<{ id: string; display_name: string }>) => ({ ok: true, json: async () => ({ members }) });

it("asks once for typers that start together, by id only, and caches names and misses", async () => {
  fetchMock.mockResolvedValue(ok([{ id: id(2), display_name: "Bob" }]));
  const both = Promise.all([roomMemberName("social", id(2)), roomMemberName("social", id(3)), roomMemberName("social", id(2))]);
  await vi.advanceTimersByTimeAsync(60);
  expect(await both).toEqual(["Bob", null, "Bob"]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("/api/chat/room-members");
  expect(JSON.parse(init.body)).toEqual({ room: "social", ids: [id(2), id(3)] });
  expect(await roomMemberName("social", id(2))).toBe("Bob");
  expect(await roomMemberName("social", id(3))).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("waits a minute after a failure instead of asking again on every typing signal", async () => {
  fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "Member list is unavailable." }) });
  const first = roomMemberName("social", id(2));
  await vi.advanceTimersByTimeAsync(60);
  expect(await first).toBeUndefined();
  for (let i = 0; i < 15; i++) {
    await vi.advanceTimersByTimeAsync(3000); // one typing signal every 3 s
    expect(await roomMemberName("social", id(2))).toBeUndefined();
  }
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fetchMock.mockResolvedValue(ok([{ id: id(2), display_name: "Bob" }]));
  await vi.advanceTimersByTimeAsync(16_000);
  const later = roomMemberName("social", id(2));
  await vi.advanceTimersByTimeAsync(60);
  expect(await later).toBe("Bob");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("keeps rooms apart", async () => {
  fetchMock.mockResolvedValue(ok([]));
  const a = roomMemberName("social", id(2)),
    b = roomMemberName("main", id(2));
  await vi.advanceTimersByTimeAsync(60);
  await Promise.all([a, b]);
  expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).room).sort()).toEqual(["main", "social"]);
});
