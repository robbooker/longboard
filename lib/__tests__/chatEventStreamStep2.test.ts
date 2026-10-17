// EVENT-STREAM step 2 (docs/chat-event-stream.md): threads, reply counts and pins on the room
// sequence, and reconnects that catch up instead of re-reading every reader.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ rpc: vi.fn(), media: vi.fn() }));
vi.mock("@/lib/chatAdmin", () => ({ createChatAdminClient: () => ({ rpc: m.rpc }) }));
vi.mock("@/lib/chatAttachmentMedia", () => ({ withAttachmentMedia: m.media }));
import { CHAT_STREAM_RECONCILE_MS, ChatEventStream, parseCatchUp, type ChatCatchUp } from "../chatEventStream";
import { ablyRoomEventActions } from "../chatRealtimeChannels";
import {
  mergeReplySummaries,
  numberedPinnedEdit,
  numberedReplyConversation,
  numberedThreadChange,
} from "../chatEventStreamRows";
import { ChatUpdateCoordinator } from "../chatUpdateCoordinator";
import { readEvents } from "../chatReads/events";
import type { ChatAuthResult } from "../chatAuth";

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (n: number, seq: number, extra: Record<string, unknown> = {}) => ({
  id: ID(n),
  room_slug: "main",
  body: `m${n}`,
  event_seq: seq,
  ...extra,
});

describe("catch-up answers", () => {
  it("reads pin numbers and the conversation of a deleted reply", () => {
    const parsed = parseCatchUp({
      head: 9,
      complete: true,
      pins: 8,
      events: [
        { seq: 7, deletedId: ID(1), parentId: ID(9) },
        { seq: 6, deletedId: ID(2), parentId: null },
        { seq: 5, deletedId: ID(3) },
      ],
    });
    expect(parsed).toEqual({
      head: 9,
      complete: true,
      pins: 8,
      events: [
        { seq: 5, deletedId: ID(3) },
        { seq: 6, deletedId: ID(2), parentId: null },
        { seq: 7, deletedId: ID(1), parentId: ID(9) },
      ],
    });
    expect(parseCatchUp({ head: 9, complete: true, pins: 0, events: [] })?.pins).toBe(0);
    // Before the migration there is no `pins` at all.
    expect(parseCatchUp({ head: 9, complete: true, events: [] })).toEqual({ head: 9, complete: true, events: [] });
    expect(parseCatchUp({ head: 9, complete: true, pins: 10, events: [] })).toBeNull();
    expect(parseCatchUp({ head: 9, complete: true, pins: "8", events: [] })).toBeNull();
    // A malformed parent is left out (the delete is still applied; its counts are re-read).
    expect(parseCatchUp({ head: 9, complete: true, events: [{ seq: 1, deletedId: ID(1), parentId: "x" }] })?.events).toEqual([
      { seq: 1, deletedId: ID(1) },
    ]);
  });

  const auth: ChatAuthResult = {
    ok: true,
    user: { id: "acct", email: "", role: "user" },
    access: { longboard: true, boardroom: true, shortscout: false, admin: false } as never,
    serverSession: false,
  };
  beforeEach(() => vi.stubEnv("CHAT_EVENT_STREAM", "all"));
  afterEach(() => vi.unstubAllEnvs());
  it("passes the pin number and parents through, and leaves them out before the migration", async () => {
    const read = async (query: string) =>
      (await readEvents(new NextRequest(`https://chat.test/api/chat/events?${query}`), auth)).json();
    m.rpc.mockResolvedValueOnce({
      data: {
        head: 9,
        pins: 8,
        rows: [],
        deleted: [
          { id: ID(1), event_seq: 7, reply_to_id: ID(5) },
          { id: ID(2), event_seq: 9, reply_to_id: null },
        ],
      },
      error: null,
    });
    expect(await read("room=social&after=6")).toEqual({
      head: 9,
      complete: true,
      pins: 8,
      events: [
        { seq: 7, deletedId: ID(1), parentId: ID(5) },
        { seq: 9, deletedId: ID(2), parentId: null },
      ],
    });
    m.rpc.mockResolvedValueOnce({ data: { head: 9, rows: [], deleted: [{ id: ID(1), event_seq: 7 }] }, error: null });
    expect(await read("room=social&after=6")).toEqual({
      head: 9,
      complete: true,
      events: [{ seq: 7, deletedId: ID(1) }],
    });
    m.rpc.mockResolvedValueOnce({ data: { head: 3, pins: 0, rows: [], deleted: [] }, error: null });
    expect(await read("room=social")).toEqual({ head: 3, complete: true, events: [], pins: 0 });
  });
});

describe("ChatEventStream (step 2)", () => {
  let answers: Array<ChatCatchUp>;
  let applied: Array<{ seqs: number[]; pins: boolean }>;
  let reconciled: string[];
  let paths: string[];
  const flush = () => vi.advanceTimersByTimeAsync(0);
  const make = () =>
    new ChatEventStream({
      read: async (path) => {
        paths.push(path);
        return Response.json(answers.shift() ?? { head: 0, complete: true, events: [] });
      },
      apply: (_room, events, changed) => applied.push({ seqs: events.map((e) => e.seq), pins: changed.pins }),
      reconcile: (room) => reconciled.push(room),
      ready: () => undefined,
      now: () => Date.now(),
    });
  beforeEach(() => {
    vi.useFakeTimers();
    answers = [];
    applied = [];
    reconciled = [];
    paths = [];
  });
  afterEach(() => vi.useRealTimers());

  it("learns that pins are numbered and reports a pin change inside the caught-up range", async () => {
    const s = make();
    s.setRooms(["main"]);
    s.setLive(true);
    expect(s.covers("main")).toBe(false); // no cursor yet
    answers.push({ head: 10, complete: true, events: [], pins: 4 });
    s.attached("main");
    await flush();
    expect(s.pinsNumbered("main")).toBe(true);
    expect(s.covers("main", "pins")).toBe(true);
    // A numbered pin signal: the head moved with no row; the catch-up says the pins changed.
    answers.push({ head: 11, complete: true, events: [], pins: 11 });
    s.event("main", { kind: "changed", topics: ["pins"], head: 11 });
    await flush();
    expect(applied).toEqual([{ seqs: [], pins: true }]);
    // A later catch-up whose last pin change is older reports no pin change.
    answers.push({ head: 12, complete: true, events: [{ seq: 12, row: row(1, 12) }], pins: 11 });
    s.event("main", { row: row(1, 13) });
    await flush();
    expect(applied.at(-1)).toEqual({ seqs: [12], pins: false });
  });

  it("without the migration never claims pins, but still covers the room's rows", async () => {
    const s = make();
    s.setRooms(["main"]);
    s.setLive(true);
    answers.push({ head: 10, complete: true, events: [] });
    s.attached("main");
    await flush();
    expect(s.pinsNumbered("main")).toBe(false);
    expect(s.covers("main")).toBe(true);
    expect(s.covers("main", "pins")).toBe(false);
    s.setLive(false);
    expect(s.covers("main")).toBe(false);
  });

  it("catches every attached room up when the tab comes back", async () => {
    const s = make();
    s.setRooms(["main", "social"]);
    s.setLive(true);
    s.attached("main");
    s.attached("social");
    await flush();
    paths.length = 0;
    s.resume();
    await flush();
    expect(paths.sort()).toEqual(["/api/chat/events?room=main&after=0", "/api/chat/events?room=social&after=0"]);
    s.setLive(false);
    paths.length = 0;
    s.resume();
    await flush();
    expect(paths).toEqual([]);
  });
});

describe("what a room event means for the thread, counts and pins", () => {
  const message = (data: Record<string, unknown>, numbered: boolean, pins = false) =>
    ablyRoomEventActions("main", ["main"], "message", { kind: "message", eventType: "INSERT", row: data }, { numbered, pins });
  it("drops the room reload for numbered rows and numbered signals in step", () => {
    const reply = row(2, 5, { reply_to_id: ID(1) });
    expect(message(reply, false).topics).toEqual(["room", "activity"]);
    expect(message(reply, false).detail?.numbered).toBeUndefined();
    expect(message(reply, true).topics).toEqual(["activity"]);
    expect(message(reply, true).detail?.numbered).toBe(true);
    const changed = (topics: string[], numbered: boolean, pins: boolean) =>
      ablyRoomEventActions("main", ["main"], "changed", { kind: "changed", topics, head: 9 }, { numbered, pins }).topics;
    expect(changed(["history", "room"], false, false)).toEqual(["history", "room", "activity"]);
    expect(changed(["history", "room"], true, false)).toEqual(["activity"]);
    // Pins: reloaded directly unless the catch-up reports them; no unread change either way.
    expect(changed(["pins"], false, false)).toEqual(["pins"]);
    expect(changed(["pins"], true, false)).toEqual(["pins"]);
    expect(changed(["pins"], true, true)).toEqual([]);
    expect(ablyRoomEventActions("main", [], "changed", { kind: "changed", topics: ["pins"] }).topics).toEqual([]);
    // Another room's row never counts as numbered here.
    expect(ablyRoomEventActions("social", ["main"], "message", { kind: "message", eventType: "INSERT", row: reply }, { numbered: true, pins: true }).detail).toBeNull();
  });

  const ids = new Set([ID(1)]);
  it("re-reads only the reply summary a numbered change can move", () => {
    const upd = (row: Record<string, unknown>, numbered = true) => ({ eventType: "UPDATE", new: row, old: {}, numbered });
    expect(numberedReplyConversation(upd(row(2, 5, { reply_to_id: ID(1) })), "main", ids)).toBe(ID(1));
    expect(numberedReplyConversation(upd(row(2, 5, { reply_to_id: ID(1) }), false), "main", ids)).toBeNull();
    expect(numberedReplyConversation(upd(row(2, 5, { reply_to_id: ID(7) })), "main", ids)).toBeNull();
    expect(numberedReplyConversation(upd(row(1, 5, { reply_to_id: null, body: "edited" })), "main", ids)).toBeNull();
    expect(numberedReplyConversation(upd({ ...row(2, 5, { reply_to_id: ID(1) }), room_slug: "social" }), "main", ids)).toBeNull();
    const del = (old: Record<string, unknown>) => ({ eventType: "DELETE", new: {}, old, numbered: true });
    expect(numberedReplyConversation(del({ id: ID(2), reply_to_id: ID(1) }), "main", ids)).toBe(ID(1));
    expect(numberedReplyConversation(del({ id: ID(2), reply_to_id: null }), "main", ids)).toBeNull();
    expect(numberedReplyConversation(del({ id: ID(2) }), "main", ids)).toBe("all"); // unknown: re-read all
  });

  it("merges a re-read of the touched conversations into the held summaries", () => {
    const held = {
      counts: { a: 2, b: 1, c: 4 },
      threads: { a: { last: "1" }, b: { last: "2" }, c: { last: "3" } },
    };
    expect(mergeReplySummaries(held, ["a", "b"], { counts: { a: 3, b: 0 }, threads: { a: { last: "9" } } })).toEqual({
      counts: { a: 3, b: 0, c: 4 },
      threads: { a: { last: "9" }, c: { last: "3" } },
    });
    // A conversation the read no longer returns (its message went away) loses its entry.
    expect(mergeReplySummaries(held, ["c"], { counts: {}, threads: {} })).toEqual({
      counts: { a: 2, b: 1 },
      threads: { a: { last: "1" }, b: { last: "2" } },
    });
  });

  it("merges the open conversation's rows and drops its deleted replies", () => {
    const thread = ID(1);
    const ev = (row: Record<string, unknown>) => ({ eventType: "UPDATE", new: row, old: {}, numbered: true });
    expect(numberedThreadChange(ev(row(2, 5, { reply_to_id: thread })), "main", thread)).toEqual({
      kind: "row",
      row: row(2, 5, { reply_to_id: thread }),
    });
    expect(numberedThreadChange(ev(row(1, 6, { body: "edited" })), "main", thread)?.kind).toBe("row");
    expect(numberedThreadChange(ev(row(1, 6, { removed: true })), "main", thread)).toEqual({ kind: "reload" });
    expect(numberedThreadChange(ev(row(3, 7, { reply_to_id: ID(9) })), "main", thread)).toBeNull();
    expect(numberedThreadChange({ ...ev(row(2, 5, { reply_to_id: thread })), numbered: false }, "main", thread)).toBeNull();
    const del = (id: string) => ({ eventType: "DELETE", new: {}, old: { id }, numbered: true });
    expect(numberedThreadChange(del(ID(2)), "main", thread)).toEqual({ kind: "delete", id: ID(2) });
    expect(numberedThreadChange(del(thread), "main", thread)).toEqual({ kind: "reload" });
  });

  it("refreshes pins only for a numbered edit of a pinned message", () => {
    const pinned = new Set([ID(1)]);
    const ev = (row: Record<string, unknown>, numbered = true) => ({ eventType: "UPDATE", new: row, old: {}, numbered });
    expect(numberedPinnedEdit(ev(row(1, 5, { body: "new" })), "main", pinned)).toBe(true);
    expect(numberedPinnedEdit(ev(row(1, 5, { body: "new" }), false), "main", pinned)).toBe(false);
    expect(numberedPinnedEdit(ev(row(2, 5)), "main", pinned)).toBe(false);
    expect(numberedPinnedEdit(ev(row(1, 5, { deleted_at: "now" })), "main", pinned)).toBe(false);
  });
});

describe("ChatUpdateCoordinator (step 2)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());
  const coordinator = () => {
    const transport = vi.fn(async (_url: unknown, init?: RequestInit) =>
      Response.json({
        results: (JSON.parse(init!.body as string).paths as string[]).map((path) => ({ path, status: 200, data: {} })),
      }),
    );
    return new ChatUpdateCoordinator({ fetch: transport as typeof fetch, active: () => true, now: () => Date.now() });
  };

  it("relaxes the pins reader only once pins are numbered", async () => {
    const c = coordinator();
    c.start();
    c.setHealthy(true);
    const pins = vi.fn(() => c.read("/api/chat/message-pins?room=main"));
    const counts = vi.fn(() => c.read("/api/chat/thread-counts?room=main"));
    c.watch(pins, ["room", "history", "pins"], false, 10000, 60000, "rooms", "main", "pins");
    c.watch(counts, ["room"], true, 10000, 60000, "rooms", "main");
    await vi.advanceTimersByTimeAsync(25);
    c.setStreamRoom("main", true, false);
    pins.mockClear();
    counts.mockClear();
    await vi.advanceTimersByTimeAsync(2 * 60000 + 100);
    expect(pins.mock.calls.length).toBeGreaterThanOrEqual(2); // still the minute
    expect(counts).toHaveBeenCalledTimes(0);
    expect(c.streamInStep("main")).toBe(true);
    c.setStreamRoom("main", true, true);
    pins.mockClear();
    // Timers fall on wall-clock multiples of the interval (phase 0): stop just before the next one.
    await vi.advanceTimersByTimeAsync(CHAT_STREAM_RECONCILE_MS - Date.now() - 1000);
    expect(pins).toHaveBeenCalledTimes(0);
    c.stop();
  });

  it("skips the re-read on reconnect for readers whose room the cursor covers, and re-times them", async () => {
    const c = coordinator();
    let covered = true;
    c.setStreamCover((room) => covered && room === "main");
    c.start();
    const history = vi.fn(() => c.read("/api/chat/history?room=main"));
    const other = vi.fn(() => c.read("/api/chat/history?room=social"));
    const bell = vi.fn(() => c.read("/api/chat/activity"));
    c.watch(history, ["history"], true, 60000, undefined, "rooms", "main");
    c.watch(other, ["history"], true, 60000, undefined, "rooms", "social");
    c.watch(bell, ["activity"], false, 10000, 30000);
    await vi.advanceTimersByTimeAsync(25);
    // Disconnected: the fast fallback, unchanged.
    history.mockClear();
    await vi.advanceTimersByTimeAsync(4100);
    expect(history.mock.calls.length).toBeGreaterThanOrEqual(2);
    history.mockClear();
    other.mockClear();
    bell.mockClear();
    c.setHealthy(true); // reconnect
    await vi.advanceTimersByTimeAsync(25);
    expect(history).toHaveBeenCalledTimes(0);
    expect(other).toHaveBeenCalledTimes(1);
    expect(bell).toHaveBeenCalledTimes(1);
    // Re-timed to the live cadence, not left on the 2-second one.
    await vi.advanceTimersByTimeAsync(5000);
    expect(history).toHaveBeenCalledTimes(0);
    // The tab coming back: the same; without a cursor everything re-reads as before.
    c.foreground("visible");
    await vi.advanceTimersByTimeAsync(25);
    expect(history).toHaveBeenCalledTimes(0);
    covered = false;
    c.foreground("visible");
    await vi.advanceTimersByTimeAsync(25);
    expect(history).toHaveBeenCalledTimes(1);
    // A refresh runs just that reader.
    history.mockClear();
    other.mockClear();
    c.refresh(history);
    await vi.advanceTimersByTimeAsync(25);
    expect(history).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(0);
    c.stop();
  });
});
