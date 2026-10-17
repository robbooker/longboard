// EVENT-STREAM step 3 (docs/chat-event-stream.md): reactions and room pause/reopen on the room
// sequence; the reactions and room status readers relax while their rooms are in step.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), media: vi.fn(), publish: vi.fn() }));
vi.mock("@/lib/chatAdmin", () => ({ createChatAdminClient: () => ({ rpc: m.rpc, from: m.from }) }));
vi.mock("@/lib/chatAttachmentMedia", () => ({ withAttachmentMedia: m.media }));
vi.mock("ably", () => ({ Rest: class { channels = { get: () => ({ publish: m.publish }) }; } }));
import {
  CHAT_STREAM_RECONCILE_MS,
  ChatEventStream,
  liveEventNumbers,
  parseCatchUp,
  type ChatCatchUp,
  type ChatStreamEvent,
} from "../chatEventStream";
import { ablyRoomEventActions } from "../chatRealtimeChannels";
import { ChatUpdateCoordinator } from "../chatUpdateCoordinator";
import { readEvents } from "../chatReads/events";
import { publishRoomEvent } from "../chatRealtimePublish";
import type { ChatAuthResult } from "../chatAuth";

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const auth: ChatAuthResult = {
  ok: true,
  user: { id: "acct", email: "", role: "user" },
  access: { longboard: true, boardroom: true, shortscout: false, admin: false } as never,
  serverSession: false,
};
const read = (query: string) => readEvents(new NextRequest(`https://chat.test/api/chat/events?${query}`), auth);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CHAT_EVENT_STREAM", "all");
});
afterEach(() => vi.unstubAllEnvs());

describe("catch-up answers", () => {
  it("lists reaction changes as events and reports the room state number", async () => {
    m.rpc.mockResolvedValue({
      data: {
        head: 9,
        pins: 0,
        state: 8,
        rows: [{ id: ID(1), room_slug: "social", body: "x", event_seq: 6 }],
        deleted: [],
        reactions: [
          { id: ID(2), event_seq: 7 },
          { id: ID(3), event_seq: 5 },
        ],
      },
      error: null,
    });
    const body = await (await read("room=social&after=4")).json();
    expect(body).toEqual({
      head: 9,
      complete: true,
      pins: 0,
      state: 8,
      events: [
        { seq: 5, reactionsId: ID(3) },
        { seq: 6, row: { id: ID(1), room_slug: "social", body: "x", event_seq: 6 } },
        { seq: 7, reactionsId: ID(2) },
      ],
    });
    expect(parseCatchUp(body)).toEqual(body);
  });
  it("answers incomplete for too many reaction changes, and as before without the migration", async () => {
    m.rpc.mockResolvedValueOnce({
      data: {
        head: 300,
        pins: 0,
        state: 0,
        rows: [],
        deleted: [],
        reactions: Array.from({ length: 101 }, (_, i) => ({ id: ID(i + 1), event_seq: i + 1 })),
      },
      error: null,
    });
    expect(await (await read("room=social&after=0")).json()).toEqual({
      head: 300,
      complete: false,
      events: [],
      pins: 0,
      state: 0,
    });
    m.rpc.mockResolvedValueOnce({ data: { head: 3, pins: 1, rows: [], deleted: [] }, error: null });
    expect(await (await read("room=social&after=0")).json()).toEqual({ head: 3, complete: true, events: [], pins: 1 });
  });
  it("validates reaction events and the state number", () => {
    expect(parseCatchUp({ head: 9, complete: true, state: 0, events: [] })?.state).toBe(0);
    expect(parseCatchUp({ head: 9, complete: true, state: 10, events: [] })).toBeNull();
    expect(parseCatchUp({ head: 9, complete: true, state: "3", events: [] })).toBeNull();
    expect(parseCatchUp({ head: 9, complete: true, events: [{ seq: 3, reactionsId: "nope" }] })).toBeNull();
    expect(parseCatchUp({ head: 9, complete: true, events: [{ seq: 3, reactionsId: ID(1) }] })?.events).toEqual([
      { seq: 3, reactionsId: ID(1) },
    ]);
  });
  it("reads a reaction signal's own number", () => {
    expect(liveEventNumbers({ kind: "changed", topics: ["reactions"], messageId: ID(1), seq: 12 })).toEqual({
      seq: 12,
      head: undefined,
    });
    expect(liveEventNumbers({ kind: "changed", topics: ["reactions"], seq: "12" })).toEqual({});
  });
});

describe("publishing", () => {
  it("numbers a reaction signal by its message's latest reaction change, and a pause by the head", async () => {
    vi.stubEnv("CHAT_ABLY_API_KEY", "app.key:secret");
    vi.stubEnv("CHAT_ABLY_ROLLOUT", "all");
    const tables: string[] = [];
    const filters: Array<[string, unknown]> = [];
    m.from.mockImplementation((table: string) => {
      tables.push(table);
      const query = {
        eq: (column: string, value: unknown) => (filters.push([column, value]), query),
        maybeSingle: async () => ({
          data: table === "longboard_chat_room_reaction_events" ? { event_seq: 14 } : { seq: 15 },
          error: null,
        }),
      };
      return { select: () => query };
    });
    await publishRoomEvent("social", { kind: "changed", topics: ["reactions"], messageId: ID(1) });
    expect(m.publish).toHaveBeenLastCalledWith("changed", {
      kind: "changed",
      topics: ["reactions"],
      messageId: ID(1),
      seq: 14,
    });
    expect(tables).toEqual(["longboard_chat_room_reaction_events"]);
    expect(filters).toEqual([
      ["message_id", ID(1)],
      ["room_slug", "social"],
    ]);
    await publishRoomEvent("social", { kind: "changed", topics: ["status"] });
    expect(m.publish).toHaveBeenLastCalledWith("changed", { kind: "changed", topics: ["status"], head: 15 });
    // Before the migration the reaction read fails: the signal goes without a number.
    m.from.mockImplementation(() => {
      const query = { eq: () => query, maybeSingle: async () => ({ data: null, error: { code: "42P01" } }) };
      return { select: () => query };
    });
    await publishRoomEvent("social", { kind: "changed", topics: ["reactions"], messageId: ID(1) });
    expect(m.publish).toHaveBeenLastCalledWith("changed", { kind: "changed", topics: ["reactions"], messageId: ID(1) });
    // Off: no read at all.
    m.from.mockClear();
    vi.stubEnv("CHAT_EVENT_STREAM", "off");
    await publishRoomEvent("social", { kind: "changed", topics: ["reactions"], messageId: ID(1) });
    expect(m.from).not.toHaveBeenCalled();
  });
});

describe("room events", () => {
  const stream = { numbered: true, pins: true, state: true };
  it("leaves a numbered pause/reopen to the catch-up once room state is numbered", () => {
    const signal = { kind: "changed", topics: ["status"], head: 9 };
    expect(ablyRoomEventActions("main", ["main"], "changed", signal, stream).topics).toEqual(["activity"]);
    // Not numbered yet (before the migration), out of step, or not on screen: as before.
    expect(ablyRoomEventActions("main", ["main"], "changed", signal, { ...stream, state: false }).topics).toEqual([
      "status",
      "activity",
    ]);
    expect(ablyRoomEventActions("main", ["main"], "changed", signal, { ...stream, numbered: false }).topics).toEqual([
      "status",
      "activity",
    ]);
    expect(ablyRoomEventActions("main", ["main"], "changed", signal).topics).toEqual(["status", "activity"]);
  });
  it("still re-reads just the one message for a reaction signal", () => {
    const signal = { kind: "changed", topics: ["reactions"], messageId: ID(4), seq: 10 };
    expect(ablyRoomEventActions("main", ["main"], "changed", signal, stream)).toEqual({
      detail: null,
      topics: ["activity"],
      reaction: { room: "main", messageId: ID(4) },
    });
  });
});

describe("ChatEventStream", () => {
  let answers: ChatCatchUp[];
  let applied: Array<{ events: ChatStreamEvent[]; changed: { pins: boolean; state: boolean } }>;
  let paths: string[];
  const flush = () => vi.advanceTimersByTimeAsync(0);
  beforeEach(() => {
    vi.useFakeTimers();
    answers = [];
    applied = [];
    paths = [];
  });
  afterEach(() => vi.useRealTimers());
  function make() {
    const s = new ChatEventStream({
      read: async (path) => {
        paths.push(path);
        return Response.json(answers.shift() ?? { head: 0, complete: true, events: [] });
      },
      apply: (_room, events, changed) => applied.push({ events, changed }),
      reconcile: () => undefined,
      ready: () => undefined,
      now: () => 1_000_000,
    });
    s.setRooms(["main"]);
    s.setLive(true);
    return s;
  }

  it("learns from a catch-up that reactions and room state are numbered", async () => {
    const s = make();
    answers.push({ head: 10, complete: true, events: [] });
    s.attached("main");
    await flush();
    // Step 2's database (no `state`): nothing more is numbered.
    expect(s.numbered("main")).toEqual({ pins: false, reactions: false, state: false });
    expect(s.covers("main", "reactions")).toBe(false);
    answers.push({ head: 12, complete: true, pins: 0, state: 0, events: [] });
    s.attached("main");
    await flush();
    expect(s.numbered("main")).toEqual({ pins: true, reactions: true, state: true });
    expect(s.covers("main", "reactions")).toBe(true);
    expect(s.covers("main", "state")).toBe(true);
  });

  it("takes an in-order reaction signal with no read, and catches up a missed one", async () => {
    const s = make();
    answers.push({ head: 10, complete: true, pins: 0, state: 0, events: [] });
    s.attached("main");
    await flush();
    paths.length = 0;
    s.event("main", { kind: "changed", topics: ["reactions"], messageId: ID(1), seq: 11 });
    await flush();
    expect(paths).toEqual([]);
    expect(s.head("main")).toBe(11);
    // 12 (a reaction) and 13 (a pause) were never heard: the next signal shows the gap.
    answers.push({
      head: 14,
      complete: true,
      pins: 0,
      state: 13,
      events: [
        { seq: 12, reactionsId: ID(2) },
        { seq: 14, reactionsId: ID(3) },
      ],
    });
    s.event("main", { kind: "changed", topics: ["reactions"], messageId: ID(3), seq: 14 });
    await flush();
    expect(paths).toEqual(["/api/chat/events?room=main&after=11"]);
    expect(applied).toEqual([
      {
        events: [
          { seq: 12, reactionsId: ID(2) },
          { seq: 14, reactionsId: ID(3) },
        ],
        changed: { pins: false, state: true },
      },
    ]);
    expect(s.head("main")).toBe(14);
    // A pause alone (only its head is published): one catch-up, reported as a state change.
    answers.push({ head: 15, complete: true, pins: 0, state: 15, events: [] });
    s.event("main", { kind: "changed", topics: ["status"], head: 15 });
    await flush();
    expect(applied.at(-1)).toEqual({ events: [], changed: { pins: false, state: true } });
    expect(s.inStep("main")).toBe(true);
  });
});

describe("ChatUpdateCoordinator", () => {
  const coordinator = () => {
    const transport = vi.fn(async (_url: unknown, init?: RequestInit) =>
      Response.json({
        results: (JSON.parse(init!.body as string).paths as string[]).map((path) => ({ path, status: 200, data: {} })),
      }),
    );
    return new ChatUpdateCoordinator({ fetch: transport as typeof fetch, active: () => true, now: () => Date.now() });
  };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

  it("relaxes the reactions reader only while every room on screen is in step with reactions numbered", async () => {
    const c = coordinator();
    c.start();
    c.setHealthy(true);
    let rooms = ["main", "social"];
    const reactions = vi.fn(() => c.read("/api/chat/message-reactions"));
    c.watch(reactions, ["inbox", "reactions"], false, 5000, 30000, "rooms", () => rooms, "reactions");
    // A reader of several rooms does not ask the stream for cursors (the rooms' own readers do).
    expect(c.streamRoomsWatched()).toEqual([]);
    await vi.advanceTimersByTimeAsync(25);
    c.setStreamRoom("main", true, { pins: true, reactions: true, state: true });
    c.setStreamRoom("social", true, { pins: true }); // step 2 only: reactions not numbered
    reactions.mockClear();
    await vi.advanceTimersByTimeAsync(2 * 30000 + 100);
    expect(reactions.mock.calls.length).toBeGreaterThanOrEqual(2); // still every 30 s
    c.setStreamRoom("social", true, { pins: true, reactions: true, state: true });
    reactions.mockClear();
    await vi.advanceTimersByTimeAsync(CHAT_STREAM_RECONCILE_MS - Date.now() - 1000);
    expect(reactions).toHaveBeenCalledTimes(0);
    // A room leaving step brings the 30 s timer back at once.
    c.setStreamRoom("social", false);
    await vi.advanceTimersByTimeAsync(30000 + 100);
    expect(reactions.mock.calls.length).toBeGreaterThanOrEqual(1);
    // Nothing on screen: the ordinary live timer.
    rooms = [];
    c.setStreamRoom("social", true, { reactions: true });
    reactions.mockClear();
    await vi.advanceTimersByTimeAsync(30000 + 100);
    expect(reactions.mock.calls.length).toBeGreaterThanOrEqual(1);
    c.stop();
  });

  it("relaxes the room status reader once room state is numbered, and skips it on reconnect", async () => {
    const c = coordinator();
    let covered = false;
    c.setStreamCover((room, need) => covered && room === "main" && need === "state");
    c.start();
    c.setHealthy(true);
    const status = vi.fn(() => c.read("/api/chat?room=main"));
    c.watch(status, ["status"], false, 10000, 60000, "rooms", "main", "state");
    await vi.advanceTimersByTimeAsync(25);
    c.setStreamRoom("main", true, { pins: true });
    status.mockClear();
    await vi.advanceTimersByTimeAsync(2 * 60000 + 100);
    expect(status.mock.calls.length).toBeGreaterThanOrEqual(2);
    c.setStreamRoom("main", true, { pins: true, reactions: true, state: true });
    status.mockClear();
    await vi.advanceTimersByTimeAsync(CHAT_STREAM_RECONCILE_MS - Date.now() - 1000);
    expect(status).toHaveBeenCalledTimes(0);
    covered = true;
    expect(c.streamCovers("main", "state")).toBe(true);
    c.foreground("visible");
    await vi.advanceTimersByTimeAsync(25);
    expect(status).toHaveBeenCalledTimes(0);
    covered = false;
    c.foreground("visible");
    await vi.advanceTimersByTimeAsync(25);
    expect(status).toHaveBeenCalledTimes(1);
    // Ably down: the old 10 s fallback.
    c.setHealthy(false);
    status.mockClear();
    await vi.advanceTimersByTimeAsync(20100);
    expect(status.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(c.streamCovers("main", "state")).toBe(false);
    c.stop();
  });
});
