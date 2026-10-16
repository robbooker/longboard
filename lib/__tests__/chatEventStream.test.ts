import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_EVENT_CURSOR_MAX_AGE_MS,
  CHAT_EVENT_RETRY_MS,
  CHAT_STREAM_RECONCILE_MS,
  ChatEventStream,
  RoomEventCursor,
  chatEventStreamKilled,
  chatEventStreamRollout,
  liveEventNumbers,
  parseCatchUp,
  type ChatCatchUp,
} from "../chatEventStream";
import { ChatUpdateCoordinator } from "../chatUpdateCoordinator";

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (n: number, seq: number) => ({ id: ID(n), body: `m${n}`, event_seq: seq });

describe("RoomEventCursor", () => {
  it("advances only on the next number of its own row", () => {
    const c = new RoomEventCursor();
    expect(c.live(5)).toBe(false); // not synced yet: nothing to compare with
    c.caughtUp(4, 0);
    expect(c.head).toBe(4);
    expect(c.behind()).toBe(true); // 5 was heard before the snapshot: read again
  });
  it("detects gaps, ignores duplicates and stale numbers, and honours published heads", () => {
    const c = new RoomEventCursor();
    c.caughtUp(10, 0);
    expect(c.live(11)).toBe(false);
    expect(c.head).toBe(11);
    expect(c.live(11)).toBe(false); // duplicate
    expect(c.live(7)).toBe(false); // older change, already counted
    expect(c.head).toBe(11);
    expect(c.live(13)).toBe(true); // 12 missing
    expect(c.head).toBe(11);
    expect(c.behind()).toBe(true);
    c.caughtUp(13, 0);
    expect(c.behind()).toBe(false);
    // An edit's own number arrives in order, but its head says another row changed too.
    expect(c.live(14, 15)).toBe(true);
    expect(c.head).toBe(14);
    // A "changed" signal with only a head.
    c.caughtUp(15, 0);
    expect(c.live(undefined, 15)).toBe(false);
    expect(c.live(undefined, 16)).toBe(true);
  });
  it("never moves backwards on an older snapshot", () => {
    const c = new RoomEventCursor();
    c.caughtUp(20, 0);
    c.caughtUp(18, 0);
    expect(c.head).toBe(20);
  });
});

describe("parsing", () => {
  it("reads the numbers a live event carries and nothing else", () => {
    expect(liveEventNumbers({ kind: "message", row: { event_seq: 4 }, head: 6 })).toEqual({ seq: 4, head: 6 });
    expect(liveEventNumbers({ kind: "message", row: { event_seq: "4" } })).toEqual({ seq: undefined, head: undefined });
    expect(liveEventNumbers({ kind: "changed", topics: ["room"], head: -1 })).toEqual({ seq: undefined, head: undefined });
    expect(liveEventNumbers(null)).toEqual({ seq: undefined, head: undefined });
  });
  it("accepts only well-formed catch-ups and orders their events", () => {
    const ok = parseCatchUp({
      head: 9,
      complete: true,
      events: [{ seq: 9, deletedId: ID(2) }, { seq: 8, row: row(1, 8) }],
    });
    expect(ok?.events.map((e) => e.seq)).toEqual([8, 9]);
    expect(parseCatchUp({ head: 3, complete: true, events: [{ seq: 4, row: row(1, 4) }] })).toBeNull(); // beyond head
    expect(parseCatchUp({ head: 3, complete: true, events: [{ seq: 2, deletedId: "nope" }] })).toBeNull();
    expect(parseCatchUp({ head: "3", complete: true, events: [] })).toBeNull();
    expect(parseCatchUp({ head: 3, events: [] })).toBeNull();
  });
  it("reads the flag and the per-session kill switch", () => {
    expect(chatEventStreamRollout(undefined)).toBe("off");
    expect(chatEventStreamRollout("all")).toBe("all");
    expect(chatEventStreamRollout("yes")).toBe("off");
    const store = new Map<string, string>();
    const s = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    expect(chatEventStreamKilled(s, "")).toBe(false);
    expect(chatEventStreamKilled(s, "?eventStream=off")).toBe(true);
    expect(chatEventStreamKilled(s, "")).toBe(true); // kept for the session
    expect(chatEventStreamKilled(s, "?eventStream=on")).toBe(false);
    expect(chatEventStreamKilled(s, "")).toBe(false);
    expect(chatEventStreamKilled(null, "")).toBe(false);
  });
});

describe("ChatEventStream", () => {
  let now = 0;
  let answers: Array<ChatCatchUp | number>;
  let paths: string[];
  let applied: Array<{ room: string; seqs: number[] }>;
  let reconciled: string[];
  let ready: Map<string, boolean>;
  let pending: Array<() => void>;
  let hold = false;
  const flush = () => vi.advanceTimersByTimeAsync(0);
  function make() {
    return new ChatEventStream({
      read: (path) => {
        paths.push(path);
        const answer = answers.shift() ?? { head: 0, complete: true, events: [] };
        const response = () =>
          typeof answer === "number" ? new Response("{}", { status: answer }) : Response.json(answer);
        if (!hold) return Promise.resolve(response());
        return new Promise<Response>((resolve) => pending.push(() => resolve(response())));
      },
      apply: (room, events) => applied.push({ room, seqs: events.map((e) => e.seq) }),
      reconcile: (room) => reconciled.push(room),
      ready: (room, inStep) => ready.set(room, inStep),
      now: () => now,
    });
  }
  beforeEach(() => {
    vi.useFakeTimers();
    now = 1_000_000;
    answers = [];
    paths = [];
    applied = [];
    reconciled = [];
    ready = new Map();
    pending = [];
    hold = false;
  });
  afterEach(() => vi.useRealTimers());

  async function synced(head = 10) {
    const s = make();
    s.setRooms(["main"]);
    s.setLive(true);
    expect(paths).toEqual([]); // nothing before the channel attaches
    answers.push({ head, complete: true, events: [] });
    s.attached("main");
    await flush();
    expect(paths).toEqual(["/api/chat/events?room=main"]);
    expect(reconciled).toEqual(["main"]); // a fresh cursor is confirmed by one full read
    expect(ready.get("main")).toBe(true);
    paths.length = 0;
    reconciled.length = 0;
    return s;
  }

  it("applies in-order events without any read and catches up a gap from the cursor", async () => {
    const s = await synced(10);
    s.event("main", { kind: "message", eventType: "INSERT", row: row(1, 11) });
    s.event("main", { kind: "message", eventType: "INSERT", row: row(1, 11) }); // duplicate
    s.event("main", { kind: "message", eventType: "INSERT", row: row(2, 12) });
    await flush();
    expect(paths).toEqual([]);
    expect(s.head("main")).toBe(12);
    answers.push({ head: 15, complete: true, events: [{ seq: 15, row: row(4, 15) }, { seq: 13, deletedId: ID(3) }] });
    s.event("main", { kind: "message", eventType: "INSERT", row: row(4, 15) });
    expect(s.inStep("main")).toBe(false);
    await flush();
    expect(paths).toEqual(["/api/chat/events?room=main&after=12"]);
    expect(applied).toEqual([{ room: "main", seqs: [13, 15] }]);
    expect(s.head("main")).toBe(15);
    expect(ready.get("main")).toBe(true);
    expect(reconciled).toEqual([]);
  });

  it("asks once for a burst of gaps and once more for numbers heard during the read", async () => {
    const s = await synced(10);
    hold = true;
    answers.push({ head: 13, complete: true, events: [] }, { head: 14, complete: true, events: [] });
    s.event("main", { row: row(1, 12) });
    s.event("main", { row: row(2, 13) });
    await flush();
    expect(paths).toHaveLength(1);
    s.event("main", { row: row(3, 14) }); // after the snapshot was taken
    pending.shift()!();
    await flush();
    expect(paths).toEqual(["/api/chat/events?room=main&after=10", "/api/chat/events?room=main&after=13"]);
    pending.shift()!();
    await flush();
    expect(s.head("main")).toBe(14);
    expect(paths).toHaveLength(2);
  });

  it("does not loop on a head claim the database never reaches", async () => {
    const s = await synced(10);
    answers.push({ head: 10, complete: true, events: [] });
    s.event("main", { kind: "changed", topics: ["history"], head: 99 });
    await flush();
    await flush();
    expect(paths).toEqual(["/api/chat/events?room=main&after=10"]);
    expect(s.inStep("main")).toBe(true);
  });

  it("repairs a gap too long to list with one full history read", async () => {
    const s = await synced(10);
    answers.push({ head: 400, complete: false, events: [] });
    s.event("main", { row: row(1, 400) });
    await flush();
    expect(reconciled).toEqual(["main"]);
    expect(s.head("main")).toBe(400);
    expect(ready.get("main")).toBe(true);
  });

  it("keeps the cursor across a disconnect and asks only for what came after it", async () => {
    const s = await synced(10);
    s.setLive(false);
    expect(ready.get("main")).toBe(false);
    s.event("main", { row: row(1, 99) }); // nothing reads while down
    expect(paths).toEqual([]);
    s.setLive(true);
    await flush();
    expect(paths).toEqual([]);
    answers.push({ head: 99, complete: true, events: [{ seq: 11, row: row(1, 11) }, { seq: 99, row: row(2, 99) }] });
    s.attached("main");
    await flush();
    expect(paths).toEqual(["/api/chat/events?room=main&after=10"]);
    expect(applied.at(-1)).toEqual({ room: "main", seqs: [11, 99] });
    expect(reconciled).toEqual([]);
    expect(ready.get("main")).toBe(true);
  });

  it("ignores an answer that arrives after the connection dropped", async () => {
    const s = await synced(10);
    hold = true;
    answers.push({ head: 12, complete: true, events: [{ seq: 12, row: row(2, 12) }] });
    s.event("main", { row: row(2, 12) });
    await flush();
    s.setLive(false);
    pending.shift()!();
    await flush();
    expect(applied).toEqual([]);
    expect(s.head("main")).toBe(10);
    expect(ready.get("main")).toBe(false);
  });

  it("re-syncs a cursor older than a day from scratch", async () => {
    const s = await synced(10);
    now += CHAT_EVENT_CURSOR_MAX_AGE_MS + 1;
    answers.push({ head: 50, complete: true, events: [] });
    s.event("main", { row: row(1, 12) });
    await flush();
    expect(paths).toEqual(["/api/chat/events?room=main"]);
    expect(reconciled).toEqual(["main"]);
  });

  it("stops for the session when the server has the stream off", async () => {
    const s = make();
    s.setRooms(["main", "social"]);
    s.setLive(true);
    answers.push(404);
    s.attached("main");
    s.attached("social");
    await flush();
    expect(s.enabled).toBe(false);
    expect(ready.get("main")).toBe(false);
    s.event("main", { row: row(1, 99) });
    s.attached("main");
    await flush();
    expect(paths).toHaveLength(2); // the two first syncs, then nothing
  });

  it("retries a failed read with backoff and stays out of step meanwhile", async () => {
    const s = make();
    s.setRooms(["main"]);
    s.setLive(true);
    answers.push(503, 503, { head: 3, complete: true, events: [] });
    s.attached("main");
    await flush();
    expect(ready.get("main")).toBe(false);
    await vi.advanceTimersByTimeAsync(CHAT_EVENT_RETRY_MS);
    expect(paths).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(CHAT_EVENT_RETRY_MS);
    expect(paths).toHaveLength(2); // doubled
    await vi.advanceTimersByTimeAsync(CHAT_EVENT_RETRY_MS);
    expect(paths).toHaveLength(3);
    expect(ready.get("main")).toBe(true);
  });

  it("follows the rooms on screen", async () => {
    const s = make();
    s.setLive(true);
    s.attached("main");
    s.attached("social");
    s.setRooms(["main"]);
    await flush();
    expect(paths).toEqual(["/api/chat/events?room=main"]);
    s.setRooms(["social"]);
    await flush();
    expect(ready.get("main")).toBe(false);
    expect(paths).toEqual(["/api/chat/events?room=main", "/api/chat/events?room=social"]);
  });
});

describe("ChatUpdateCoordinator with an in-step room", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());
  it("relaxes only that room's history reader to five minutes, and only while live", async () => {
    const transport = vi.fn(async (_url: unknown, init?: RequestInit) =>
      Response.json({
        results: (JSON.parse(init!.body as string).paths as string[]).map((path) => ({ path, status: 200, data: {} })),
      }),
    );
    const c = new ChatUpdateCoordinator({ fetch: transport as typeof fetch, active: () => true, now: () => Date.now() });
    c.start();
    c.setHealthy(true);
    const seen: string[][] = [];
    c.onStreamRooms((rooms) => seen.push(rooms));
    const history = vi.fn(() => c.read("/api/chat/history?room=main"));
    const other = vi.fn(() => c.read("/api/chat/history?room=social"));
    c.watch(history, ["history"], true, 60000, undefined, "rooms", "main");
    c.watch(other, ["history"], true, 60000, undefined, "rooms", "social");
    expect(seen.at(-1)).toEqual(["main", "social"]);
    await vi.advanceTimersByTimeAsync(25);
    c.setStreamRoom("main", true);
    history.mockClear();
    other.mockClear();
    await vi.advanceTimersByTimeAsync(CHAT_STREAM_RECONCILE_MS - 1000);
    expect(history).toHaveBeenCalledTimes(0);
    expect(other.mock.calls.length).toBeGreaterThanOrEqual(4);
    await vi.advanceTimersByTimeAsync(2000);
    expect(history).toHaveBeenCalledTimes(1);
    // Ably drops: back to the fast fallback at once.
    c.setHealthy(false);
    history.mockClear();
    await vi.advanceTimersByTimeAsync(4100);
    expect(history.mock.calls.length).toBeGreaterThanOrEqual(2);
    // Out of step again: back to the minute.
    c.setHealthy(true);
    c.setStreamRoom("main", false);
    history.mockClear();
    await vi.advanceTimersByTimeAsync(61000);
    expect(history.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(history.mock.calls.length).toBeLessThanOrEqual(2);
    c.stop();
  });
});
