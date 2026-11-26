// #502: the live video API routes, with LiveKit, sign-in, the database and Ably all faked.
//  - status: only for someone who can read the room; nothing asked of LiveKit when it is not set up;
//  - token: the room check, members only while live, watch-only, browser sign-in only, rate limited;
//  - live (#512: the room's permanent address and key, and Reset key): chat admins only, the key
//    never reaches anyone else, and an ingress the room already has is always reused;
//  - livekit-webhook: only a genuinely signed call counts; other rooms and repeats are ignored.
// #507:
//  - on-screen (the host sets or clears the stock): chat admins only, a real ticker only, only while
//    started; kept in the LiveKit room's metadata; this server's memory is dropped and the room told;
//  - status carries what is on screen; stock answers only Polygon's numbers for one clean ticker,
//    and (#512) only so many times in five minutes for one account.
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import type { StageIngress } from "@/lib/chatStageVideo";

const KEY = "APIfakekey";
const SECRET = "fake-secret-never-real-0123456789abcdef";
const FAKE_STREAM_KEY = "FAKE-STREAM-KEY-not-real";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  member: vi.fn(),
  publish: vi.fn(),
  notice: vi.fn(),
  lk: {
    ingresses: [] as StageIngress[],
    calls: [] as string[],
    made: 0,
    fail: false,
    metadata: new Map<string, string>(),
    failMetadata: false,
    // #522: who is connected to a video room, by identity (the stand-in for LiveKit's participants).
    viewers: new Map<string, { joinedAt: number; tab?: string }>(),
    failViewers: false,
  },
  quotes: vi.fn(),
  shares: vi.fn(),
}));
vi.mock("@/lib/chatGainersQuotes", () => ({ gainersQuotes: mocks.quotes }));
vi.mock("@/lib/chatGainersShares", () => ({ gainersShares: mocks.shares }));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: mocks.auth }));
vi.mock("@/lib/chatAdmin", () => ({ createChatAdminClient: () => ({}) }));
vi.mock("@/lib/chatMembers", () => ({ findChatMember: mocks.member }));
vi.mock("@/lib/chatRealtimePublish", () => ({ publishRoomEventAfterResponse: mocks.publish }));
// #503: what the "live now" notice does with a hint is lib/__tests__/chatStageNotify.test.ts; here, only that it is asked.
vi.mock("@/lib/chatStageNotifyServer", () => ({ stageNoticeAfterResponse: mocks.notice }));
vi.mock("@/lib/chatStageLiveKit", async (original) => ({
  ...(await original<typeof import("@/lib/chatStageLiveKit")>()),
  stageVideoApi: () => ({
    ingresses: async (room: string) => {
      mocks.lk.calls.push(`list:${room}`);
      if (mocks.lk.fail) throw new Error("down");
      return mocks.lk.ingresses;
    },
    createIngress: async (room: string) => {
      mocks.lk.calls.push(`create:${room}`);
      if (mocks.lk.fail) throw new Error("down");
      const made = ++mocks.lk.made;
      // The first key made is FAKE_STREAM_KEY; each later one differs.
      const ingress = { id: `IN_${made}`, url: "rtmps://fake.livekit.test/x", streamKey: made === 1 ? "FAKE-STREAM-KEY-not-real" : `FAKE-STREAM-KEY-not-real-${made}`, publishing: false };
      mocks.lk.ingresses = [...mocks.lk.ingresses, ingress];
      return ingress;
    },
    deleteIngress: async (id: string) => {
      mocks.lk.calls.push(`delete:${id}`);
      mocks.lk.ingresses = mocks.lk.ingresses.filter((ingress) => ingress.id !== id);
    },
    roomMetadata: async (room: string) => {
      mocks.lk.calls.push(`metadata:${room}`);
      if (mocks.lk.failMetadata) throw new Error("down");
      return mocks.lk.metadata.get(room) ?? null;
    },
    setRoomMetadata: async (room: string, metadata: string) => {
      mocks.lk.calls.push(`setMetadata:${room}`);
      if (mocks.lk.failMetadata) throw new Error("down");
      mocks.lk.metadata.set(room, metadata);
    },
    viewerToken: async (room: string, identity: string, name: string, tab?: string) => `token|${room}|${identity}|${name}${tab ? `|${tab}` : ""}`,
    viewer: async (room: string, identity: string) => {
      mocks.lk.calls.push(`viewer:${room}:${identity}`);
      if (mocks.lk.failViewers) throw new Error("down");
      return mocks.lk.viewers.get(identity) ?? null;
    },
    removeViewer: async (room: string, identity: string) => {
      mocks.lk.calls.push(`remove:${room}:${identity}`);
      return mocks.lk.viewers.delete(identity);
    },
    closeRoom: async (room: string) => {
      mocks.lk.calls.push(`close:${room}`);
      mocks.lk.metadata.delete(room);
      mocks.lk.viewers.clear();
    },
    videoRooms: async () => ["chat-main"],
  }),
}));
import { GET as status } from "@/app/api/chat/stage/status/route";
import { POST as token } from "@/app/api/chat/stage/token/route";
import { GET as liveGet, POST as livePost } from "@/app/api/chat/stage/live/route";
import { POST as webhook } from "@/app/api/chat/stage/livekit-webhook/route";
import { POST as onScreenPost } from "@/app/api/chat/stage/on-screen/route";
import { GET as stockGet } from "@/app/api/chat/stage/stock/route";
import { forgetStageChanges, stageChangeTiming } from "@/lib/chatStageChange";
import { STAGE_SETTLED_MEMORY_MS, STAGE_STATE_MEMORY_MS, forgetStageState, forgetStageWebhooks } from "@/lib/chatStageVideo";

const access = { longboard: true, boardroom: true, shortscout: false, admin: false };
const member = (over: Record<string, unknown> = {}) => ({ ok: true, user: { id: "acct-bob", email: "bob@example.test", role: "user" }, access, serverSession: false, ...over });
const admin = () => ({ ok: true, user: { id: "acct-alice", email: "alice@example.test", role: "admin" }, access: { ...access, admin: true }, serverSession: false });
const outsider = () => member({ access: { longboard: false, shortscout: false, shortscoutMember: true, admin: false } }); // Social, not LB
const get = (path: string) => new NextRequest(`https://example.test${path}`);
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`https://example.test${path}`, { method: "POST", headers: { "Content-Type": "application/json", origin: "https://example.test", host: "example.test", ...headers }, body: JSON.stringify(body) });
const live = (publishing: boolean): StageIngress[] => [{ id: "IN_0", url: "rtmps://fake.livekit.test/x", streamKey: FAKE_STREAM_KEY, publishing }];

/** Lets the work a route leaves for "after the response" (which runs at once outside a request) finish. */
const settled = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};
/** The LiveKit calls so far, without the per-seat lookups a token makes. */
const lkCalls = () => mocks.lk.calls.filter((call) => !call.startsWith("viewer:"));
const waits: number[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  forgetStageState();
  // The grace before a room is closed, and the second look after a webhook, do not really wait here.
  waits.length = 0;
  forgetStageChanges();
  stageChangeTiming.wait = async (ms) => void waits.push(ms);
  mocks.lk.viewers = new Map();
  mocks.lk.failViewers = false;
  forgetStageWebhooks();
  mocks.lk.ingresses = [];
  mocks.lk.calls = [];
  mocks.lk.made = 0;
  mocks.lk.fail = false;
  mocks.lk.metadata = new Map();
  mocks.lk.failMetadata = false;
  mocks.quotes.mockImplementation(async (tickers: string[]) => new Map(tickers.map((t) => [t, t === "FRSH" ? { price: 10, changePct: 100, volume: 12_345_678 } : null])));
  mocks.shares.mockImplementation(async (tickers: string[]) => new Map(tickers.map((t) => [t, t === "FRSH" ? 120_000_000 : null])));
  mocks.auth.mockResolvedValue(member());
  mocks.member.mockResolvedValue({ id: "member-bob", display_name: "Bob Test", accepts_requests: true });
  process.env.LIVEKIT_URL = "wss://fake.livekit.test";
  process.env.LIVEKIT_API_KEY = KEY;
  process.env.LIVEKIT_API_SECRET = SECRET;
  delete process.env.CHAT_STAGE_MODE;
});

describe("GET /api/chat/stage/status", () => {
  it("needs a sign-in and the room", async () => {
    mocks.auth.mockResolvedValue({ ok: false, status: 401, error: "unauthenticated" });
    expect((await status(get("/api/chat/stage/status?room=main"))).status).toBe(401);
    mocks.auth.mockResolvedValue(member());
    expect((await status(get("/api/chat/stage/status?room=nowhere"))).status).toBe(400);
    mocks.auth.mockResolvedValue(outsider());
    expect((await status(get("/api/chat/stage/status?room=main"))).status).toBe(403);
    expect(mocks.lk.calls).toEqual([]);
  });
  it("is off, and asks LiveKit nothing, when live video is not set up", async () => {
    for (const name of ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"]) {
      const saved = process.env[name];
      delete process.env[name];
      const response = await status(get("/api/chat/stage/status?room=main"));
      expect(await response.json()).toEqual({ state: "off", video: false });
      process.env[name] = saved;
    }
    expect(mocks.lk.calls).toEqual([]);
  });
  it("says off (never set up), waiting (set up, nothing broadcasting) or live, and is never cached by a browser or CDN", async () => {
    expect(await (await status(get("/api/chat/stage/status?room=main"))).json()).toEqual({ state: "off", video: true, onScreen: null });
    forgetStageState();
    mocks.lk.ingresses = live(false);
    expect(await (await status(get("/api/chat/stage/status?room=main"))).json()).toEqual({ state: "waiting", video: true, onScreen: null });
    forgetStageState();
    mocks.lk.ingresses = live(true);
    const response = await status(get("/api/chat/stage/status?room=main"));
    const body = await response.json();
    expect(body).toEqual({ state: "live", video: true, onScreen: null });
    expect(JSON.stringify(body)).not.toContain(FAKE_STREAM_KEY);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("asks LiveKit once for many requests", async () => {
    mocks.lk.ingresses = live(true);
    await Promise.all(Array.from({ length: 25 }, () => status(get("/api/chat/stage/status?room=main"))));
    await status(get("/api/chat/stage/status?room=main"));
    expect(mocks.lk.calls).toEqual(["list:chat-main", "metadata:chat-main"]);
  });
  it("#523: a room at rest costs ordinary chat almost nothing: waiting is remembered for half a minute, nothing else is read, and a read caused by a signal is never answered from that memory", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-05T15:00:00Z"));
      const plain = async () => (await (await status(get("/api/chat/stage/status?room=main"))).json()).state;
      const signalled = async () => (await (await status(get("/api/chat/stage/status?room=main&fresh=1"))).json()).state;
      // (The room being closed after a stop has its own test below: here its grace never ends.)
      stageChangeTiming.wait = () => new Promise<void>(() => undefined);
      mocks.lk.ingresses = live(false);
      mocks.lk.metadata.set("chat-main", '{"onScreen":"APUS","at":1700000000000}');
      expect(await (await status(get("/api/chat/stage/status?room=main"))).json()).toEqual({ state: "waiting", video: true, onScreen: null });
      // One LiveKit call: the ingress list. The stock on screen is not read for a member while nothing is live.
      expect(mocks.lk.calls).toEqual(["list:chat-main"]);
      expect(mocks.notice).toHaveBeenCalledTimes(1);
      // Ordinary room opens and switches for the next half minute: nothing asked of LiveKit, nothing looked at.
      for (const seconds of [1, 5, 12, 29]) {
        vi.setSystemTime(new Date(Date.parse("2026-01-05T15:00:00Z") + seconds * 1000));
        expect(await plain()).toBe("waiting");
      }
      expect(mocks.lk.calls).toEqual(["list:chat-main"]);
      // The broadcast starts and this server is not told (the webhook went to another one). A page
      // that asks because of the room's signal is answered from LiveKit, not from the long memory...
      mocks.lk.ingresses = live(true);
      expect(await plain()).toBe("waiting");
      expect(await signalled()).toBe("live");
      // ...and from then on everyone on this server is told live.
      expect(await plain()).toBe("live");
      expect(mocks.lk.calls).toEqual(["list:chat-main", "list:chat-main", "metadata:chat-main"]);
      // Live is only ever remembered for the few seconds.
      mocks.lk.ingresses = live(false);
      vi.setSystemTime(new Date(Date.parse("2026-01-05T15:00:29Z") + STAGE_STATE_MEMORY_MS - 1));
      expect(await plain()).toBe("live");
      vi.setSystemTime(new Date(Date.parse("2026-01-05T15:00:29Z") + STAGE_STATE_MEMORY_MS));
      expect(await plain()).toBe("waiting");
      // A signalled read inside the few seconds shares the answer (a burst costs one call), and reads again after them.
      const calls = mocks.lk.calls.length;
      expect(await signalled()).toBe("waiting");
      expect(mocks.lk.calls).toHaveLength(calls);
      vi.setSystemTime(new Date(Date.now() + STAGE_STATE_MEMORY_MS));
      expect(await signalled()).toBe("waiting");
      expect(mocks.lk.calls).toHaveLength(calls + 1);
      // The long memory ends by itself: the longest a LIVE button can be late with no signal at all.
      const at = Date.now();
      mocks.lk.ingresses = live(true);
      vi.setSystemTime(new Date(at + STAGE_SETTLED_MEMORY_MS - 1));
      expect(await plain()).toBe("waiting");
      vi.setSystemTime(new Date(at + STAGE_SETTLED_MEMORY_MS));
      expect(await plain()).toBe("live");
      // The cards' request for several rooms follows the same rule.
      forgetStageState();
      mocks.lk.ingresses = live(false);
      mocks.lk.calls = [];
      await status(get("/api/chat/stage/status?rooms=main,gainers"));
      vi.setSystemTime(new Date(Date.now() + 20_000));
      await status(get("/api/chat/stage/status?rooms=main,gainers"));
      expect([...mocks.lk.calls].sort()).toEqual(["list:chat-gainers", "list:chat-main"]);
      await status(get("/api/chat/stage/status?rooms=main,gainers&fresh=1"));
      expect([...mocks.lk.calls].sort()).toEqual(["list:chat-gainers", "list:chat-gainers", "list:chat-main", "list:chat-main"]);
    } finally {
      vi.useRealTimers();
    }
  });
  it("#523: a failed read is never remembered for long, and a room that has only ever waited is not looked at once a minute", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-05T16:00:00Z"));
      const plain = async () => (await (await status(get("/api/chat/stage/status?room=main"))).json()).state;
      mocks.lk.fail = true;
      expect(await plain()).toBe("off");
      mocks.lk.fail = false;
      mocks.lk.ingresses = live(false);
      vi.setSystemTime(new Date(Date.now() + STAGE_STATE_MEMORY_MS));
      expect(await plain()).toBe("waiting");
      expect(mocks.notice).toHaveBeenCalledTimes(1);
      // Ten minutes of ordinary chat in a room at rest: a LiveKit call each half minute, and no look at its message.
      mocks.lk.calls = [];
      for (let i = 0; i < 20; i++) {
        vi.setSystemTime(new Date(Date.now() + STAGE_SETTLED_MEMORY_MS));
        expect(await plain()).toBe("waiting");
      }
      expect(mocks.lk.calls).toEqual(Array.from({ length: 20 }, () => "list:chat-main"));
      expect(mocks.notice).toHaveBeenCalledTimes(1);
      // While live, the message is still looked at once a minute (a missed end must be noticed).
      mocks.lk.ingresses = live(true);
      vi.setSystemTime(new Date(Date.now() + STAGE_SETTLED_MEMORY_MS));
      expect(await plain()).toBe("live");
      expect(mocks.notice).toHaveBeenCalledTimes(2);
      vi.setSystemTime(new Date(Date.now() + 61_000));
      expect(await plain()).toBe("live");
      expect(mocks.notice).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
  it("#523: an admin is still told the stock on screen while the room waits; a member's page never causes that read", async () => {
    mocks.lk.ingresses = live(false);
    mocks.lk.metadata.set("chat-main", '{"onScreen":"APUS","at":1700000000000}');
    expect((await (await status(get("/api/chat/stage/status?room=main"))).json()).onScreen).toBeNull();
    expect(mocks.lk.calls).toEqual(["list:chat-main"]);
    mocks.auth.mockResolvedValue(admin());
    expect((await (await status(get("/api/chat/stage/status?room=main"))).json()).onScreen).toEqual({ symbol: "APUS", at: 1_700_000_000_000 });
    expect(mocks.lk.calls).toEqual(["list:chat-main", "metadata:chat-main"]);
  });
  it("#522: the room must be named: no room, an empty one or an unknown one is refused, and an empty entry in a list is not LB", async () => {
    mocks.lk.ingresses = live(true);
    for (const path of ["/api/chat/stage/status", "/api/chat/stage/status?room=", "/api/chat/stage/status?room=nowhere", "/api/chat/stage/status?fresh=1"]) {
      const response = await status(get(path));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_room" });
    }
    expect(await (await status(get("/api/chat/stage/status?rooms="))).json()).toEqual({ states: {}, video: true });
    expect(await (await status(get("/api/chat/stage/status?rooms=,,nowhere,"))).json()).toEqual({ states: {}, video: true });
    expect(mocks.lk.calls).toEqual([]);
  });
  it("#522: a broadcast this server saw live and now reads as stopped has its LiveKit room closed after the grace, once; one that came back is left alone", async () => {
    const fresh = async () => (await (await status(get("/api/chat/stage/status?room=main&fresh=1"))).json()).state;
    mocks.lk.ingresses = live(true);
    expect(await fresh()).toBe("live");
    forgetStageState("main");
    mocks.lk.ingresses = live(false);
    expect(await fresh()).toBe("waiting");
    await settled();
    expect(waits).toEqual([30_000]);
    expect(lkCalls().filter((call) => call.startsWith("close"))).toEqual(["close:chat-main"]);
    // Waiting, and waiting again: nothing more is closed.
    forgetStageState("main");
    expect(await fresh()).toBe("waiting");
    await settled();
    expect(lkCalls().filter((call) => call.startsWith("close"))).toHaveLength(1);
    // A stop that is over by the end of the grace (the broadcast came back): the room is not closed.
    forgetStageState("main");
    mocks.lk.ingresses = live(true);
    expect(await fresh()).toBe("live");
    forgetStageState("main");
    mocks.lk.ingresses = live(false);
    stageChangeTiming.wait = async () => void (mocks.lk.ingresses = live(true));
    expect(await fresh()).toBe("waiting");
    await settled();
    expect(lkCalls().filter((call) => call.startsWith("close"))).toHaveLength(1);
  });
  it("answers off when LiveKit cannot be reached", async () => {
    mocks.lk.fail = true;
    expect(await (await status(get("/api/chat/stage/status?room=main"))).json()).toEqual({ state: "off", video: true, onScreen: null });
  });
  it("#512: a fresh answer that differs from this server's last has the room's message checked after the response; a remembered one, and a room never set up, do not", async () => {
    const ask = async () => (await (await status(get("/api/chat/stage/status?room=main"))).json()).state;
    expect(await ask()).toBe("off");
    expect(await ask()).toBe("off");
    expect(mocks.notice).not.toHaveBeenCalled();
    // Set up, waiting: looked at once (there may be a message from before), then not again for a minute.
    forgetStageState("main");
    mocks.lk.ingresses = live(false);
    expect(await ask()).toBe("waiting");
    expect(mocks.notice).toHaveBeenCalledExactlyOnceWith("main", expect.anything(), null, { tellRoom: true });
    forgetStageState("main");
    expect(await ask()).toBe("waiting");
    expect(mocks.notice).toHaveBeenCalledTimes(1);
    // The broadcast arrives with no webhook: the next fresh read notices. Members asking again do not repeat it.
    forgetStageState("main");
    mocks.lk.ingresses = live(true);
    await Promise.all(Array.from({ length: 10 }, ask));
    expect(await ask()).toBe("live");
    expect(mocks.notice).toHaveBeenCalledTimes(2);
    // It stops with no webhook and no End button: noticed the same way.
    forgetStageState("main");
    mocks.lk.ingresses = live(false);
    expect(await ask()).toBe("waiting");
    expect(mocks.notice).toHaveBeenCalledTimes(3);
    expect(mocks.notice.mock.calls.every((call) => call[0] === "main" && call[2] === null && call[3]?.tellRoom === true)).toBe(true);
    // The status itself tells the room nothing, and LiveKit being down checks nothing.
    expect(mocks.publish).not.toHaveBeenCalled();
    forgetStageState("main");
    mocks.lk.fail = true;
    expect(await ask()).toBe("off");
    expect(mocks.notice).toHaveBeenCalledTimes(3);
  });
  it("#507: carries the stock on screen for a set-up room, and asks LiveKit nothing more for a room that is off", async () => {
    mocks.lk.metadata.set("chat-main", '{"onScreen":"APUS","at":1700000000000}');
    // Off: the room's metadata is not even read.
    expect(await (await status(get("/api/chat/stage/status?room=main"))).json()).toEqual({ state: "off", video: true, onScreen: null });
    expect(mocks.lk.calls).toEqual(["list:chat-main"]);
    forgetStageState();
    mocks.lk.ingresses = live(true);
    expect(await (await status(get("/api/chat/stage/status?room=main"))).json()).toEqual({ state: "live", video: true, onScreen: { symbol: "APUS", at: 1_700_000_000_000 } });
    // Cleared, and metadata that is not this app's: nothing on screen.
    forgetStageState();
    mocks.lk.metadata.set("chat-main", '{"onScreen":null,"at":1700000000001}');
    expect((await (await status(get("/api/chat/stage/status?room=main"))).json()).onScreen).toEqual({ symbol: null, at: 1_700_000_000_001 });
    forgetStageState();
    mocks.lk.metadata.set("chat-main", "something else");
    expect((await (await status(get("/api/chat/stage/status?room=main"))).json()).onScreen).toBeNull();
    // The metadata read failing never takes the live state with it.
    forgetStageState();
    mocks.lk.failMetadata = true;
    expect(await (await status(get("/api/chat/stage/status?room=main"))).json()).toEqual({ state: "live", video: true, onScreen: null });
  });
  // #505: Dual, Quad and Six view ask for their cards' rooms in one request.
  it("answers several rooms at once, leaving out rooms the member cannot read or that do not exist", async () => {
    mocks.lk.ingresses = live(true);
    const response = await status(get("/api/chat/stage/status?rooms=main,gainers,main,nowhere,shortscout"));
    const body = await response.json();
    expect(body).toEqual({ states: { main: "live", gainers: "live" }, video: true });
    expect(JSON.stringify(body)).not.toContain(FAKE_STREAM_KEY);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    // One LiveKit read per room and nothing else (#507's stock on screen is not asked for cards)...
    expect([...mocks.lk.calls].sort()).toEqual(["list:chat-gainers", "list:chat-main"]);
    // ...and that read is shared with the single-room answer, which adds only its own stock read.
    await status(get("/api/chat/stage/status?room=main"));
    expect([...mocks.lk.calls].sort()).toEqual(["list:chat-gainers", "list:chat-main", "metadata:chat-main"]);
    mocks.auth.mockResolvedValue(outsider());
    expect(await (await status(get("/api/chat/stage/status?rooms=main,lb-announcements"))).json()).toEqual({ states: {}, video: true });
  });
  // #505 + #512 together: a room that only has its permanent key is "waiting" (no card button), and
  // the check of the "live now" message is bounded: one room per request, the rest on a later read.
  it("answers waiting for rooms that only have their key, and checks one room's message per request", async () => {
    mocks.lk.ingresses = live(false);
    expect(await (await status(get("/api/chat/stage/status?rooms=main,gainers"))).json()).toEqual({ states: { main: "waiting", gainers: "waiting" }, video: true });
    expect(mocks.notice).toHaveBeenCalledTimes(1);
    // Remembered answers check nothing; the next fresh read looks at the room that had to wait.
    await status(get("/api/chat/stage/status?rooms=main,gainers"));
    expect(mocks.notice).toHaveBeenCalledTimes(1);
    forgetStageState("main");
    forgetStageState("gainers");
    await status(get("/api/chat/stage/status?rooms=main,gainers"));
    expect(mocks.notice).toHaveBeenCalledTimes(2);
    expect(mocks.notice.mock.calls.map((call) => call[0]).sort()).toEqual(["gainers", "main"]);
    expect(mocks.notice.mock.calls.every((call) => call[2] === null && call[3]?.tellRoom === true)).toBe(true);
    // Nothing has changed since: no more checks, however often the cards ask.
    forgetStageState("main");
    forgetStageState("gainers");
    await status(get("/api/chat/stage/status?rooms=main,gainers"));
    expect(mocks.notice).toHaveBeenCalledTimes(2);
    // Rooms never set up ask for no check at all.
    mocks.notice.mockClear();
    forgetStageState();
    mocks.lk.ingresses = [];
    expect(await (await status(get("/api/chat/stage/status?rooms=main,gainers"))).json()).toEqual({ states: { main: "off", gainers: "off" }, video: true });
    expect(mocks.notice).not.toHaveBeenCalled();
  });
  it("asks LiveKit nothing for several rooms when live video is not set up", async () => {
    delete process.env.LIVEKIT_URL;
    expect(await (await status(get("/api/chat/stage/status?rooms=main,gainers"))).json()).toEqual({ states: { main: "off", gainers: "off" }, video: false });
    expect(mocks.lk.calls).toEqual([]);
  });
});

describe("POST /api/chat/stage/on-screen (#507)", () => {
  const set = (symbol: unknown, headers: Record<string, string> = {}, room = "main") => onScreenPost(post("/api/chat/stage/on-screen", { room, symbol }, headers));
  it("refuses a member, an admin's API token, an agent, a signed-out caller and another site, and touches nothing", async () => {
    mocks.lk.ingresses = live(true);
    expect((await set("APUS")).status).toBe(403);
    expect(await (await set(null)).json()).toEqual({ error: "admin_only" });
    mocks.auth.mockResolvedValue({ ...admin(), apiToken: true });
    expect((await set("APUS")).status).toBe(403);
    mocks.auth.mockResolvedValue({ ...admin(), agent: { id: "a" } });
    expect((await set("APUS")).status).toBe(403);
    mocks.auth.mockResolvedValue({ ok: false, status: 401, error: "unauthenticated" });
    expect((await set("APUS")).status).toBe(401);
    mocks.auth.mockResolvedValue(admin());
    expect((await set("APUS", { origin: "https://evil.test" })).status).toBe(403);
    expect(mocks.lk.calls).toEqual([]);
    expect(mocks.lk.metadata.size).toBe(0);
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("takes only a real ticker (or null) for a real room", async () => {
    mocks.auth.mockResolvedValue(admin());
    mocks.lk.ingresses = live(true);
    for (const bad of ["", "TOOLONG", "AB1", "$APUS", "A B", "<b>", 7, undefined, { symbol: "APUS" }]) {
      const response = await set(bad);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_symbol" });
    }
    expect((await set("APUS", {}, "nowhere")).status).toBe(400);
    expect(mocks.lk.calls).toEqual([]);
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("#522: the body must be a JSON object that names its room: a missing room never puts a stock on LB's screen", async () => {
    mocks.auth.mockResolvedValue(admin());
    mocks.lk.ingresses = live(true);
    const raw = (body: string) => onScreenPost(new NextRequest("https://example.test/api/chat/stage/on-screen", { method: "POST", headers: { "Content-Type": "application/json", origin: "https://example.test", host: "example.test" }, body }));
    for (const body of ['{"symbol":"APUS"}', '{"room":null,"symbol":"APUS"}', '{"room":7,"symbol":null}', '{"room":"","symbol":"APUS"}', "null", "[]", '"APUS"', "7", "not json", ""]) {
      const response = await raw(body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_room" });
    }
    const bare = await onScreenPost(new NextRequest("https://example.test/api/chat/stage/on-screen", { method: "POST", headers: { host: "example.test" }, body: '{"room":"main","symbol":"APUS"}' }));
    expect(bare.status).toBe(403);
    expect(mocks.lk.calls).toEqual([]);
    expect(mocks.lk.metadata.size).toBe(0);
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("sets it for an admin: saved in the LiveKit room, uncached, the room told with the ticker, and the next status has it", async () => {
    mocks.auth.mockResolvedValue(admin());
    mocks.lk.ingresses = live(true);
    // This server remembers "nothing on screen" from a moment ago.
    expect((await (await status(get("/api/chat/stage/status?room=main"))).json()).onScreen).toBeNull();
    mocks.lk.calls = [];
    mocks.notice.mockClear(); // (#512: that first status had the room's message looked at; setting a stock never does)
    const before = Date.now();
    const response = await set(" brk-b ");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const { onScreen } = await response.json();
    expect(onScreen.symbol).toBe("BRK.B");
    expect(onScreen.at).toBeGreaterThanOrEqual(before);
    expect(mocks.lk.calls).toEqual(["list:chat-main", "setMetadata:chat-main"]);
    expect(JSON.parse(mocks.lk.metadata.get("chat-main")!)).toEqual({ onScreen: "BRK.B", at: onScreen.at });
    expect(mocks.publish).toHaveBeenCalledExactlyOnceWith("main", { kind: "changed", topics: ["stage"], onScreen });
    expect(mocks.notice).not.toHaveBeenCalled();
    // The few seconds' memory was dropped: someone opening the stage right now reads the new stock.
    mocks.auth.mockResolvedValue(member());
    expect(await (await status(get("/api/chat/stage/status?room=main"))).json()).toEqual({ state: "live", video: true, onScreen });
  });
  it("clears it with null", async () => {
    mocks.auth.mockResolvedValue(admin());
    mocks.lk.ingresses = live(false);
    await set("APUS");
    mocks.publish.mockClear();
    const response = await set(null);
    const { onScreen } = await response.json();
    expect(onScreen.symbol).toBeNull();
    expect(JSON.parse(mocks.lk.metadata.get("chat-main")!)).toEqual({ onScreen: null, at: onScreen.at });
    expect(mocks.publish).toHaveBeenCalledExactlyOnceWith("main", { kind: "changed", topics: ["stage"], onScreen });
    expect((await (await status(get("/api/chat/stage/status?room=main"))).json()).onScreen).toEqual(onScreen);
  });
  it("#512: whenever the room has its stream key, broadcasting or not; refused for a room never set up; says so when LiveKit is down or not set up", async () => {
    mocks.auth.mockResolvedValue(admin());
    const off = await set("APUS");
    expect(off.status).toBe(409);
    expect(await off.json()).toEqual({ error: "not_started" });
    expect(mocks.lk.metadata.size).toBe(0);
    // An admin opens the stage (the room gets its key): from then on a stock can be set, with nothing broadcasting.
    expect((await livePost(post("/api/chat/stage/live", { room: "main", action: "open" }))).status).toBe(200);
    expect(mocks.lk.ingresses.map((ingress) => ingress.publishing)).toEqual([false]);
    expect((await (await set("APUS")).json()).onScreen.symbol).toBe("APUS");
    expect(JSON.parse(mocks.lk.metadata.get("chat-main")!).onScreen).toBe("APUS");
    mocks.publish.mockClear();
    mocks.lk.failMetadata = true;
    expect((await set("APUS")).status).toBe(502);
    expect(mocks.publish).not.toHaveBeenCalled();
    delete process.env.LIVEKIT_API_SECRET;
    expect((await set("APUS")).status).toBe(404);
  });
});

describe("GET /api/chat/stage/stock (#507)", () => {
  const gainers = () => member();
  const onScreen = (symbol: string | null) => mocks.lk.metadata.set("chat-main", JSON.stringify({ onScreen: symbol, at: 1_700_000_000_000 }));
  const lookup = (ticker = "FRSH", room = "main") => stockGet(get(`/api/chat/stage/stock?room=${room}&ticker=${ticker}`));
  it("answers Polygon's numbers for the ticker on screen in that room, and nothing more", async () => {
    mocks.auth.mockResolvedValue(gainers());
    onScreen("FRSH");
    const response = await lookup();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ ticker: "FRSH", quote: { price: 10, changePct: 100, volume: 12_345_678 }, sharesOutstanding: 120_000_000 });
    // Polygon down: dashes, not an error page.
    mocks.quotes.mockRejectedValue(new Error("down"));
    mocks.shares.mockRejectedValue(new Error("down"));
    expect(await (await lookup()).json()).toEqual({ ticker: "FRSH", quote: null, sharesOutstanding: null });
  });
  it("#523: answers ONLY for the ticker on screen in that room, so it cannot be used to look up other stocks", async () => {
    mocks.auth.mockResolvedValue(gainers());
    // Nothing on screen (no LiveKit room at all), then cleared, then another stock: every lookup is refused.
    for (const set of [() => undefined, () => onScreen(null), () => onScreen("AEHL")]) {
      forgetStageState();
      set();
      const refused = await lookup("FRSH");
      expect(refused.status).toBe(409);
      expect(await refused.json()).toEqual({ error: "not_on_screen" });
    }
    expect((await lookup("AEHL")).status).toBe(200);
    expect(mocks.quotes).toHaveBeenCalledTimes(1);
    expect(mocks.quotes).toHaveBeenCalledWith(["AEHL"]);
    // What is on screen is this server's few-second memory of the LiveKit room: one read for many lookups.
    mocks.lk.calls = [];
    for (let i = 0; i < 5; i++) await lookup("AEHL");
    expect(mocks.lk.calls).toEqual([]);
    // The room must be named, be real, and be one the member can read; live video must be set up.
    expect((await stockGet(get("/api/chat/stage/stock?ticker=AEHL"))).status).toBe(400);
    expect(await (await stockGet(get("/api/chat/stage/stock?ticker=AEHL"))).json()).toEqual({ error: "invalid_room" });
    expect((await lookup("AEHL", "nowhere")).status).toBe(400);
    expect((await lookup("AEHL", "shortscout")).status).toBe(403);
    delete process.env.LIVEKIT_URL;
    expect((await lookup("AEHL")).status).toBe(404);
    expect(mocks.quotes).toHaveBeenCalledTimes(6);
  });
  it("needs a sign-in, the Gainers room and one clean ticker", async () => {
    onScreen("FRSH");
    mocks.auth.mockResolvedValue({ ok: false, status: 401, error: "unauthenticated" });
    expect((await lookup()).status).toBe(401);
    mocks.auth.mockResolvedValue(member({ access: { longboard: false, boardroom: false, shortscout: false, admin: false } }));
    expect((await lookup()).status).toBe(403);
    mocks.auth.mockResolvedValue(gainers());
    for (const bad of ["", "frsh", "FRSH,AEHL", "TOOLONG", "A1", "%24FRSH", "BRK-B"]) expect((await lookup(bad)).status).toBe(400);
    expect((await stockGet(get("/api/chat/stage/stock?room=main"))).status).toBe(400);
    expect(mocks.quotes).not.toHaveBeenCalled();
    expect(mocks.shares).not.toHaveBeenCalled();
  });
  it("#512: one account gets 60 lookups in five minutes, then 429 until the window passes; other accounts are not affected", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-05T15:00:00Z"));
      onScreen("FRSH");
      const as = (id: string) => mocks.auth.mockResolvedValue(member({ user: { id, email: `${id}@example.test`, role: "user" } }));
      as("acct-looker");
      const answers = [];
      // A lookup for a stock that is not on screen is refused, and still counts.
      for (let i = 0; i < 62; i++) answers.push((await lookup(i % 2 ? "FRSH" : "ZZZT")).status);
      expect(answers.slice(0, 60)).toEqual(Array.from({ length: 60 }, (_, i) => (i % 2 ? 200 : 409)));
      expect(answers.slice(60)).toEqual([429, 429]);
      const refused = await lookup();
      expect(await refused.json()).toEqual({ error: "rate_limited" });
      expect(refused.headers.get("Cache-Control")).toBe("private, no-store");
      // A refused lookup asks Polygon nothing.
      expect(mocks.quotes).toHaveBeenCalledTimes(30);
      expect(mocks.shares).toHaveBeenCalledTimes(30);
      // Someone else is not held up, and a bad ticker never counts.
      as("acct-other");
      expect((await lookup()).status).toBe(200);
      for (let i = 0; i < 70; i++) expect((await lookup("bad1")).status).toBe(400);
      expect((await lookup()).status).toBe(200);
      // Five minutes after the first lookup, the account may ask again.
      as("acct-looker");
      vi.setSystemTime(new Date("2026-01-05T15:04:59Z"));
      expect((await lookup()).status).toBe(429);
      vi.setSystemTime(new Date("2026-01-05T15:05:00Z"));
      expect((await lookup()).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("POST /api/chat/stage/token", () => {
  const ask = (room = "main", headers = {}, more: Record<string, unknown> = {}) => token(post("/api/chat/stage/token", { room, ...more }, headers));
  const identityOf = async (response: Response) => ((await response.json()).token as string).split("|")[2];
  it("gives a member of a live room a watch token named for them", async () => {
    mocks.lk.ingresses = live(true);
    const response = await ask();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.url).toBe("wss://fake.livekit.test");
    expect(body.token).toBe("token|chat-main|member-bob#00000001|Bob Test");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(mocks.member).toHaveBeenCalledWith(expect.anything(), "acct-bob");
  });
  it("#522: reads who is asking fresh from the database, never from the 30-second sign-in memory", async () => {
    mocks.lk.ingresses = live(true);
    await ask();
    expect(mocks.auth).toHaveBeenCalledExactlyOnceWith(expect.anything(), undefined, { fresh: true });
    // Suspended a moment ago: the fresh read says so, and no token is made whatever a server remembered.
    mocks.auth.mockResolvedValue({ ok: false, status: 401, error: "unauthenticated" });
    const refused = await ask();
    expect(refused.status).toBe(401);
    expect((await refused.json()).token).toBeUndefined();
  });
  it("#522: a member has two seats in a room; every token is for one of them, whatever is asked", async () => {
    mocks.lk.ingresses = live(true);
    mocks.auth.mockResolvedValue(member({ user: { id: "acct-seats", email: "s@example.test", role: "user" } }));
    const seats = ["member-bob#00000001", "member-bob#00000002"];
    // Nobody connected: the seat asked for (a stage tab asks for 1, a card or a phone for 2; anything else is 1).
    expect(await identityOf(await ask("main", {}, { seat: 1 }))).toBe(seats[0]);
    expect(await identityOf(await ask("main", {}, { seat: 2 }))).toBe(seats[1]);
    for (const seat of [0, 3, 99, -1, 1.5, "2", null]) expect(await identityOf(await ask("main", {}, { seat }))).toBe(seats[0]);
    // Each token costs one small lookup per seat, and nothing else of LiveKit.
    mocks.lk.calls = [];
    await ask();
    expect(mocks.lk.calls).toEqual([`viewer:chat-main:${seats[0]}`, `viewer:chat-main:${seats[1]}`]);
    // One screen connected in seat 1: a second screen gets seat 2 (two tabs do not knock each other off)...
    mocks.lk.viewers.set(seats[0], { joinedAt: 1_000, tab: "tabaaaaaaa" });
    expect(await identityOf(await ask("main", {}, { tab: "tabbbbbbbb", seat: 1 }))).toBe(seats[1]);
    // ...and the first screen reconnecting (the same tab) gets its own seat back, replacing only itself.
    mocks.lk.viewers.set(seats[1], { joinedAt: 2_000, tab: "tabbbbbbbb" });
    expect(await identityOf(await ask("main", {}, { tab: "tabaaaaaaa", seat: 2 }))).toBe(seats[0]);
    expect(await identityOf(await ask("main", {}, { tab: "tabbbbbbbb", seat: 1 }))).toBe(seats[1]);
    // A third screen: no third seat. It takes the seat that joined longest ago.
    expect(await identityOf(await ask("main", {}, { tab: "tabccccccc", seat: 2 }))).toBe(seats[0]);
    mocks.lk.viewers.set(seats[0], { joinedAt: 3_000, tab: "tabccccccc" });
    expect(await identityOf(await ask("main", {}, { tab: "tabddddddd" }))).toBe(seats[1]);
    // The tab's name rides on the token (so LiveKit can say who holds a seat); a bad one is dropped.
    expect((await (await ask("main", {}, { tab: "tabccccccc" })).json()).token).toBe(`token|chat-main|${seats[0]}|Bob Test|tabccccccc`);
    expect((await (await ask("main", {}, { tab: "<script>" })).json()).token).toMatch(/^token\|chat-main\|member-bob#0000000[12]\|Bob Test$/);
    // LiveKit cannot say who is connected: a token is still given, and still for one of the two seats.
    mocks.lk.failViewers = true;
    expect(seats).toContain(await identityOf(await ask("main", {}, { tab: "tabeeeeeee", seat: 2 })));
  });
  it("#522: the limit holds across servers: many tokens from two server instances are only ever for the member's two seats", async () => {
    mocks.lk.ingresses = live(true);
    mocks.auth.mockResolvedValue(member({ user: { id: "acct-cap", email: "cap@example.test", role: "user" } }));
    // A second server instance: its own copy of the route and of everything it remembers (its rate
    // limit, its memory of the room), talking to the same LiveKit.
    vi.resetModules();
    const other = (await import("@/app/api/chat/stage/token/route")).POST;
    const identities = new Set<string>();
    for (let i = 0; i < 36; i++) {
      const route = i % 2 ? other : token;
      const response = await route(post("/api/chat/stage/token", { room: "main", tab: `tab${String(i).padStart(7, "0")}`, seat: (i % 3) + 1 }));
      expect(response.status).toBe(200);
      const identity = ((await response.json()).token as string).split("|")[2];
      identities.add(identity);
      // Each one joins: LiveKit keeps one connection per identity, so joining takes that seat over.
      mocks.lk.viewers.set(identity, { joinedAt: 10_000 + i, tab: `tab${String(i).padStart(7, "0")}` });
    }
    expect([...identities].sort()).toEqual(["member-bob#00000001", "member-bob#00000002"]);
    expect(mocks.lk.viewers.size).toBe(2);
    // Another member's seats are their own.
    mocks.member.mockResolvedValue({ id: "member-cara", display_name: "Cara Test", accepts_requests: true });
    mocks.auth.mockResolvedValue(member({ user: { id: "acct-cara", email: "c@example.test", role: "user" } }));
    expect(await identityOf(await ask())).toBe("member-cara#00000001");
  });
  it("refuses a member while the room is not live", async () => {
    expect((await ask()).status).toBe(409);
    forgetStageState();
    mocks.lk.ingresses = live(false);
    const waiting = await ask();
    expect(waiting.status).toBe(409);
    expect((await waiting.json()).token).toBeUndefined();
  });
  it("#512: an admin too gets a token only while the room is live: its key existing is no reason to connect", async () => {
    mocks.auth.mockResolvedValue(admin());
    expect((await ask()).status).toBe(409);
    forgetStageState();
    mocks.lk.ingresses = live(false);
    const waiting = await ask();
    expect(waiting.status).toBe(409);
    expect(await waiting.json()).toEqual({ error: "not_live", state: "waiting" });
    forgetStageState();
    mocks.lk.ingresses = live(true);
    expect((await ask()).status).toBe(200);
  });
  it("refuses someone who cannot read the room, even while it is live", async () => {
    mocks.lk.ingresses = live(true);
    mocks.auth.mockResolvedValue(outsider());
    const response = await ask();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "room_forbidden" });
    expect(mocks.lk.calls).toEqual([]);
  });
  it("#522: the room must be named, as text, in a JSON object: a missing room is never taken to mean LB", async () => {
    mocks.lk.ingresses = live(true);
    const raw = (body: string) => token(new NextRequest("https://example.test/api/chat/stage/token", { method: "POST", headers: { "Content-Type": "application/json", origin: "https://example.test", host: "example.test" }, body }));
    for (const body of ["{}", '{"room":null}', '{"room":7}', '{"room":["main"]}', '{"room":""}', '{"room":"nowhere"}', "null", "[]", '"main"', "7", "not json", ""]) {
      const response = await raw(body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_room" });
    }
    expect(mocks.lk.calls).toEqual([]);
  });
  it("refuses a signed-out caller, another site, an API token, an agent and a bot", async () => {
    mocks.lk.ingresses = live(true);
    expect((await ask("main", { origin: "https://evil.test" })).status).toBe(403);
    // #522: and a request that does not say where it came from at all.
    const bare = await token(new NextRequest("https://example.test/api/chat/stage/token", { method: "POST", headers: { host: "example.test" }, body: '{"room":"main"}' }));
    expect(bare.status).toBe(403);
    expect(await bare.json()).toEqual({ error: "origin_not_allowed" });
    expect(mocks.auth).not.toHaveBeenCalled();
    mocks.auth.mockResolvedValue({ ok: false, status: 401, error: "unauthenticated" });
    expect((await ask()).status).toBe(401);
    for (const kind of [{ apiToken: true }, { agent: { id: "a" } }, { access: { ...access, botRooms: ["main"] } }]) {
      mocks.auth.mockResolvedValue(member(kind));
      expect((await ask()).status).toBe(403);
    }
  });
  it("is off when live video is not set up", async () => {
    mocks.lk.ingresses = live(true);
    delete process.env.LIVEKIT_API_SECRET;
    expect((await ask()).status).toBe(404);
    process.env.LIVEKIT_API_SECRET = SECRET;
    process.env.CHAT_STAGE_MODE = "off";
    expect((await ask()).status).toBe(404);
  });
  it("needs a chat member, and limits how often one account may ask", async () => {
    mocks.lk.ingresses = live(true);
    mocks.auth.mockResolvedValue(member({ user: { id: "acct-nobody", email: "n@example.test", role: "user" } }));
    mocks.member.mockResolvedValue(null);
    expect((await ask()).status).toBe(403);
    mocks.auth.mockResolvedValue(member({ user: { id: "acct-loop", email: "l@example.test", role: "user" } }));
    mocks.member.mockResolvedValue({ id: "member-loop", display_name: "Loop", accepts_requests: true });
    const answers = [];
    for (let i = 0; i < 22; i++) answers.push((await ask()).status);
    expect(answers.slice(0, 20).every((code) => code === 200)).toBe(true);
    expect(answers.slice(20)).toEqual([429, 429]);
  });
});

describe("/api/chat/stage/live (#512: the room's permanent stream address and key)", () => {
  const act = (action: string, headers = {}, room = "main") => livePost(post("/api/chat/stage/live", { room, action }, headers));
  const read = (room = "main") => liveGet(get(`/api/chat/stage/live?room=${room}`));
  const creates = () => mocks.lk.calls.filter((call) => call.startsWith("create"));
  const deletes = () => mocks.lk.calls.filter((call) => call.startsWith("delete"));
  it("never tells a member anything, and changes nothing for them", async () => {
    mocks.lk.ingresses = live(true);
    for (const response of [await read(), await act("open"), await act("reset"), await act("refresh"), await act("start"), await act("end")]) {
      expect(response.status).toBe(403);
      const text = JSON.stringify(await response.json());
      expect(text).toBe('{"error":"admin_only"}');
      expect(text).not.toContain(FAKE_STREAM_KEY);
    }
    expect(mocks.lk.calls).toEqual([]);
    expect(mocks.lk.ingresses).toEqual(live(true));
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("refuses an admin's API token, an agent, a signed-out caller and another site, for open and for reset", async () => {
    mocks.lk.ingresses = live(false);
    for (const action of ["open", "reset"]) {
      mocks.auth.mockResolvedValue({ ...admin(), apiToken: true });
      expect((await read()).status).toBe(403);
      expect((await act(action)).status).toBe(403);
      mocks.auth.mockResolvedValue({ ...admin(), agent: { id: "a" } });
      expect((await act(action)).status).toBe(403);
      mocks.auth.mockResolvedValue({ ok: false, status: 401, error: "unauthenticated" });
      expect((await act(action)).status).toBe(401);
      mocks.auth.mockResolvedValue(admin());
      expect((await act(action, { origin: "https://evil.test" })).status).toBe(403);
    }
    expect(mocks.lk.calls).toEqual([]);
    expect(mocks.lk.ingresses).toEqual(live(false));
  });
  it("open, the first time: makes the room's ingress and answers the address and key, uncached, with a signal that carries neither", async () => {
    mocks.auth.mockResolvedValue(admin());
    // Reading alone makes nothing.
    expect(await (await read()).json()).toEqual({ state: "off" });
    expect(mocks.lk.calls).toEqual(["list:chat-main"]);
    const response = await act("open");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: "waiting", address: "rtmps://fake.livekit.test/x", streamKey: FAKE_STREAM_KEY, created: true });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(creates()).toEqual(["create:chat-main"]);
    expect(mocks.publish).toHaveBeenCalledExactlyOnceWith("main", { kind: "changed", topics: ["stage"] });
    expect(JSON.stringify(mocks.publish.mock.calls)).not.toContain(FAKE_STREAM_KEY);
    // Nothing is broadcasting: nobody is told anything, and no "live now" message is looked for.
    expect(mocks.notice).not.toHaveBeenCalled();
  });
  it("open is the same every time after that: the same key, nothing made, nothing deleted, nobody signalled", async () => {
    mocks.auth.mockResolvedValue(admin());
    await act("open");
    mocks.publish.mockClear();
    for (let i = 0; i < 4; i++) {
      const response = await act("open");
      expect(await response.json()).toEqual({ state: "waiting", address: "rtmps://fake.livekit.test/x", streamKey: FAKE_STREAM_KEY });
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect(await (await read()).json()).toEqual({ state: "waiting", address: "rtmps://fake.livekit.test/x", streamKey: FAKE_STREAM_KEY });
    expect(creates()).toHaveLength(1);
    expect(deletes()).toEqual([]);
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.notice).not.toHaveBeenCalled();
    // Another room gets its own, and only when its own card is opened.
    expect(mocks.lk.calls.some((call) => call.includes("chat-social"))).toBe(false);
  });
  it("an ingress the room already has is reused as it is (the key in StreamYard keeps working), live or not", async () => {
    mocks.auth.mockResolvedValue(admin());
    for (const publishing of [false, true]) {
      mocks.lk.ingresses = live(publishing);
      mocks.lk.calls = [];
      for (const response of [await act("open"), await act("open"), await read()])
        expect(await response.json()).toEqual({ state: publishing ? "live" : "waiting", address: "rtmps://fake.livekit.test/x", streamKey: FAKE_STREAM_KEY });
      expect(mocks.lk.calls).toEqual(["list:chat-main", "list:chat-main", "list:chat-main"]);
      expect(mocks.lk.ingresses).toEqual(live(publishing));
    }
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("more than one ingress for the room: the one in use is shown, the others are counted and left alone", async () => {
    mocks.auth.mockResolvedValue(admin());
    const stray = { id: "IN_stray", url: "rtmps://fake.livekit.test/x", streamKey: "FAKE-STRAY-KEY-not-real", publishing: false };
    mocks.lk.ingresses = [stray, ...live(true)];
    expect(await (await act("open")).json()).toEqual({ state: "live", address: "rtmps://fake.livekit.test/x", streamKey: FAKE_STREAM_KEY, extra: 1 });
    expect(mocks.lk.ingresses).toHaveLength(2);
    expect(creates()).toEqual([]);
    expect(deletes()).toEqual([]);
  });
  it("reset: the old ingress is deleted, a new key answered, the room told (without the key) and its message checked", async () => {
    mocks.auth.mockResolvedValue(admin());
    mocks.lk.ingresses = [{ ...live(true)[0], streamKey: "FAKE-OLD-KEY-not-real" }];
    const response = await act("reset");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ state: "waiting", address: "rtmps://fake.livekit.test/x", streamKey: FAKE_STREAM_KEY, created: true });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await settled();
    // #522: and the LiveKit room is closed at once (no grace), so nobody stays connected to a room whose broadcast was cut off.
    expect(mocks.lk.calls).toEqual(["list:chat-main", "delete:IN_0", "create:chat-main", "close:chat-main"]);
    expect(waits).toEqual([]);
    expect(mocks.lk.ingresses.map((ingress) => ingress.id)).toEqual(["IN_1"]);
    expect(mocks.publish).toHaveBeenCalledExactlyOnceWith("main", { kind: "changed", topics: ["stage"] });
    expect(JSON.stringify(mocks.publish.mock.calls)).not.toMatch(/FAKE-(STREAM|OLD)-KEY/);
    expect(mocks.notice.mock.calls.map((call) => [call[0], call[2]])).toEqual([["main", "acct-alice"]]);
    // Again: a different key each time, and the newest is what opening the card shows from then on.
    const again = await (await act("reset")).json();
    expect(again.streamKey).not.toBe(body.streamKey);
    expect(await (await act("open")).json()).toEqual({ state: "waiting", address: "rtmps://fake.livekit.test/x", streamKey: again.streamKey });
    expect(mocks.lk.ingresses).toHaveLength(1);
    // The status forgot what it remembered: a member's next look says nothing is live, and carries no key.
    mocks.auth.mockResolvedValue(member());
    const seen = await (await status(get("/api/chat/stage/status?room=main"))).json();
    expect(seen).toEqual({ state: "waiting", video: true, onScreen: null });
    expect(JSON.stringify(seen)).not.toContain("FAKE-STREAM-KEY");
  });
  it("there is no start and no end any more: both are refused and change nothing", async () => {
    mocks.auth.mockResolvedValue(admin());
    mocks.lk.ingresses = live(true);
    for (const action of ["start", "end", "nonsense", undefined as unknown as string]) {
      const response = await act(action);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_action" });
    }
    expect(mocks.lk.calls).toEqual([]);
    expect(mocks.lk.ingresses).toEqual(live(true));
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("#522: the body must be a JSON object that names its room; a reset that names no room never touches LB", async () => {
    mocks.auth.mockResolvedValue(admin());
    mocks.lk.ingresses = live(true);
    const raw = (body: string) => livePost(new NextRequest("https://example.test/api/chat/stage/live", { method: "POST", headers: { "Content-Type": "application/json", origin: "https://example.test", host: "example.test" }, body }));
    for (const body of ['{"action":"reset"}', '{"action":"open"}', '{"action":"refresh"}', '{"room":null,"action":"reset"}', '{"room":7,"action":"reset"}', '{"room":"","action":"reset"}', "null", "[]", '"reset"', "7", "not json", ""]) {
      const response = await raw(body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_room" });
    }
    expect((await liveGet(get("/api/chat/stage/live"))).status).toBe(400);
    expect((await liveGet(get("/api/chat/stage/live?room="))).status).toBe(400);
    await settled();
    // Nothing was read, deleted, made or closed, and nobody was told anything.
    expect(mocks.lk.calls).toEqual([]);
    expect(mocks.lk.ingresses).toEqual(live(true));
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.notice).not.toHaveBeenCalled();
    // A request that does not say where it came from is refused before anything else.
    const bare = await livePost(new NextRequest("https://example.test/api/chat/stage/live", { method: "POST", headers: { host: "example.test" }, body: '{"room":"main","action":"reset"}' }));
    expect(bare.status).toBe(403);
    expect(mocks.lk.calls).toEqual([]);
  });
  it("#523: an admin player's refresh tells the room only when the state is new to this server, however many players report", async () => {
    mocks.auth.mockResolvedValue(admin());
    mocks.lk.ingresses = live(false);
    // The first report: this server had not acted on the room yet.
    expect((await act("refresh")).status).toBe(200);
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    expect(mocks.notice).toHaveBeenCalledTimes(1);
    // The broadcast arrives: three admins' players each report it, twice. The room is told once.
    mocks.lk.ingresses = live(true);
    for (let i = 0; i < 6; i++) expect((await act("refresh")).status).toBe(200);
    expect(mocks.publish).toHaveBeenCalledTimes(2);
    expect(mocks.notice.mock.calls.map((call) => [call[0], call[2]])).toEqual([["main", "acct-alice"], ["main", "acct-alice"]]);
    // It drops: told once more, and the room is closed after the grace because this server had it live.
    mocks.lk.ingresses = live(false);
    for (let i = 0; i < 6; i++) expect((await act("refresh")).status).toBe(200);
    await settled();
    expect(mocks.publish).toHaveBeenCalledTimes(3);
    expect(mocks.notice).toHaveBeenCalledTimes(3);
    expect(mocks.lk.calls.filter((call) => call.startsWith("close"))).toEqual(["close:chat-main"]);
    expect(waits).toEqual([30_000]);
  });
  it("#503: reset and the player's refresh each ask for the room's notice to be checked, as that admin; opening and reading do not", async () => {
    mocks.auth.mockResolvedValue(admin());
    for (const action of ["open", "refresh", "reset"]) expect((await act(action)).status).toBe(200);
    expect(mocks.notice.mock.calls.map((call) => [call[0], call[2]])).toEqual([["main", "acct-alice"], ["main", "acct-alice"]]);
    mocks.notice.mockClear();
    await read();
    await act("open");
    mocks.auth.mockResolvedValue(member());
    for (const action of ["open", "refresh", "reset"]) expect((await act(action)).status).toBe(403);
    expect(mocks.notice).not.toHaveBeenCalled();
  });
  it("is off without the LiveKit settings, and says so when LiveKit fails", async () => {
    mocks.auth.mockResolvedValue(admin());
    mocks.lk.fail = true;
    for (const response of [await act("open"), await act("reset"), await read()]) {
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: "livekit_unavailable" });
    }
    expect(mocks.publish).not.toHaveBeenCalled();
    delete process.env.LIVEKIT_URL;
    expect((await act("open")).status).toBe(404);
    expect((await act("reset")).status).toBe(404);
    expect((await read()).status).toBe(404);
  });
});

describe("POST /api/chat/stage/livekit-webhook", () => {
  const signed = async (event: Record<string, unknown>, secret = SECRET) => {
    const body = JSON.stringify(event);
    const signer = new AccessToken(KEY, secret);
    signer.sha256 = createHash("sha256").update(body).digest("base64");
    return new NextRequest("https://example.test/api/chat/stage/livekit-webhook", {
      method: "POST",
      headers: { "Content-Type": "application/webhook+json", Authorization: await signer.toJwt() },
      body,
    });
  };
  const started = (id: string, room = "chat-main") => ({ event: "ingress_started", id, ingressInfo: { ingressId: "IN_1", roomName: room } });
  it("a genuine event forgets the remembered status and tells the room", async () => {
    // The status is remembered as off...
    expect(await (await status(get("/api/chat/stage/status?room=main"))).json()).toMatchObject({ state: "off" });
    mocks.lk.ingresses = live(true);
    expect(await (await status(get("/api/chat/stage/status?room=main"))).json()).toMatchObject({ state: "off" });
    // ...until LiveKit says the broadcast started.
    expect((await webhook(await signed(started("EV_1")))).status).toBe(200);
    expect(mocks.publish).toHaveBeenCalledExactlyOnceWith("main", { kind: "changed", topics: ["stage"] });
    expect(await (await status(get("/api/chat/stage/status?room=main"))).json()).toMatchObject({ state: "live" });
  });
  // #523. LiveKit reports a start as room_started + ingress_started + track_published, and a stop
  // as participant_left + ingress_ended + room_finished: six events, two changes.
  const START = [
    { event: "room_started", id: "EV_s1", room: { name: "chat-main" } },
    { event: "ingress_started", id: "EV_s2", ingressInfo: { ingressId: "IN_1", roomName: "chat-main" } },
    { event: "track_published", id: "EV_s3", room: { name: "chat-main" }, participant: { identity: "stage-broadcast" } },
  ];
  const STOP = [
    { event: "participant_left", id: "EV_e1", room: { name: "chat-main" }, participant: { identity: "stage-broadcast" } },
    { event: "ingress_ended", id: "EV_e2", ingressInfo: { ingressId: "IN_1", roomName: "chat-main" } },
    { event: "room_finished", id: "EV_e3", room: { name: "chat-main" } },
  ];
  it("#523: the six events of a broadcast starting and stopping tell the room twice, look at its message twice and close the room once", async () => {
    // This server knows the room as waiting (an admin's player reported it earlier).
    mocks.lk.ingresses = live(false);
    expect((await webhook(await signed({ event: "room_finished", id: "EV_0", room: { name: "chat-main" } }))).status).toBe(200);
    await settled();
    mocks.publish.mockClear();
    mocks.notice.mockClear();
    mocks.lk.calls = [];
    waits.length = 0;
    // The broadcast starts.
    mocks.lk.ingresses = live(true);
    for (const event of START) expect((await webhook(await signed(event))).status).toBe(200);
    await settled();
    expect(mocks.publish).toHaveBeenCalledExactlyOnceWith("main", { kind: "changed", topics: ["stage"] });
    expect(mocks.notice).toHaveBeenCalledTimes(1);
    expect(mocks.lk.calls.filter((call) => call.startsWith("close"))).toEqual([]);
    // Each event still made this server forget and read the state (so its next status answer is right).
    expect(mocks.lk.calls).toEqual(["list:chat-main", "list:chat-main", "list:chat-main"]);
    expect(await (await status(get("/api/chat/stage/status?room=main"))).json()).toMatchObject({ state: "live" });
    // It stops.
    mocks.lk.ingresses = live(false);
    for (const event of STOP) expect((await webhook(await signed(event))).status).toBe(200);
    await settled();
    expect(mocks.publish).toHaveBeenCalledTimes(2);
    expect(mocks.notice).toHaveBeenCalledTimes(2);
    // No admin is behind a webhook.
    expect(mocks.notice.mock.calls.every((call) => call[0] === "main" && call[2] === undefined)).toBe(true);
    // #522: after the grace, with the broadcast still stopped, the LiveKit room is closed: once.
    expect(waits).toEqual([30_000]);
    expect(mocks.lk.calls.filter((call) => call.startsWith("close"))).toEqual(["close:chat-main"]);
    // LiveKit repeating all six changes nothing.
    for (const event of [...START, ...STOP]) expect((await webhook(await signed(event))).status).toBe(200);
    await settled();
    expect(mocks.publish).toHaveBeenCalledTimes(2);
    expect(mocks.notice).toHaveBeenCalledTimes(2);
    expect(mocks.lk.calls.filter((call) => call.startsWith("close"))).toHaveLength(1);
  });
  it("#523: an event that arrives a moment before LiveKit's own answer changes is looked at once more, so a go-live is never swallowed", async () => {
    mocks.lk.ingresses = live(false);
    expect((await webhook(await signed({ event: "room_finished", id: "EV_0", room: { name: "chat-main" } }))).status).toBe(200);
    await settled();
    mocks.publish.mockClear();
    mocks.notice.mockClear();
    waits.length = 0;
    // All three "started" events arrive while LiveKit still answers "not publishing"; it does a moment later.
    stageChangeTiming.wait = async (ms) => {
      waits.push(ms);
      mocks.lk.ingresses = live(true);
    };
    for (const event of START) expect((await webhook(await signed(event))).status).toBe(200);
    await settled();
    // One second look (not one per event), and the room is told then.
    expect(waits).toEqual([3_000]);
    expect(mocks.publish).toHaveBeenCalledExactlyOnceWith("main", { kind: "changed", topics: ["stage"] });
    expect(mocks.notice).toHaveBeenCalledTimes(1);
    expect(await (await status(get("/api/chat/stage/status?room=main"))).json()).toMatchObject({ state: "live" });
  });
  it("#523: when LiveKit cannot be read, the room is told and its message checked as before (a hiccup never hides a change)", async () => {
    mocks.lk.fail = true;
    expect((await webhook(await signed(START[1]))).status).toBe(200);
    await settled();
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    expect(mocks.notice).toHaveBeenCalledTimes(1);
    expect(mocks.lk.calls.filter((call) => call.startsWith("close"))).toEqual([]);
  });
  it("#522: a server that never saw the room live still closes it when the event itself says the broadcast went; a stray room event closes nothing", async () => {
    // A cold server: its first event is the room being made (an admin put a stock on screen before the
    // broadcast). The room is waiting: nothing is closed, so that stock stays.
    mocks.lk.ingresses = live(false);
    expect((await webhook(await signed(START[0]))).status).toBe(200);
    await settled();
    expect(mocks.lk.calls.filter((call) => call.startsWith("close"))).toEqual([]);
    // Another cold server, whose first event is the broadcast ending.
    forgetStageState();
    mocks.lk.calls = [];
    expect((await webhook(await signed(STOP[1]))).status).toBe(200);
    await settled();
    expect(mocks.lk.calls.filter((call) => call.startsWith("close"))).toEqual(["close:chat-main"]);
  });
  it("#522: an event with no id is refused and nothing is done (it could not be told from a repeat)", async () => {
    mocks.lk.ingresses = live(true);
    for (const event of [
      { event: "ingress_started", id: "", ingressInfo: { ingressId: "IN_1", roomName: "chat-main" } },
      { event: "ingress_started", ingressInfo: { ingressId: "IN_1", roomName: "chat-main" } },
      { event: "ingress_ended", id: "", ingressInfo: { ingressId: "IN_1", roomName: "chat-main" } },
    ])
      expect((await webhook(await signed(event))).status).toBe(400);
    await settled();
    expect(mocks.lk.calls).toEqual([]);
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.notice).not.toHaveBeenCalled();
  });
  it("handles each room apart, and ignores viewers", async () => {
    mocks.lk.ingresses = live(true);
    const events = [
      { event: "track_published", id: "EV_a", room: { name: "chat-main" }, participant: { identity: "stage-broadcast" } },
      { event: "room_started", id: "EV_c", room: { name: "chat-social" } },
    ];
    for (const event of events) expect((await webhook(await signed(event))).status).toBe(200);
    expect(mocks.publish.mock.calls.map((call) => call[0])).toEqual(["main", "social"]);
    mocks.publish.mockClear();
    mocks.lk.calls = [];
    for (const event of [
      { event: "participant_joined", id: "EV_f", room: { name: "chat-main" }, participant: { identity: "member-bob#00000001" } },
      { event: "participant_left", id: "EV_g", room: { name: "chat-main" }, participant: { identity: "member-bob#00000001" } },
      { event: "track_published", id: "EV_h", room: { name: "chat-main" }, participant: { identity: "someone-else" } },
    ])
      expect((await webhook(await signed(event))).status).toBe(200);
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.lk.calls).toEqual([]);
  });
  it("refuses a bad signature, a changed body and a missing header", async () => {
    expect((await webhook(await signed(started("EV_2"), "some-other-secret-0123456789abcdef0123"))).status).toBe(401);
    const real = await signed(started("EV_3"));
    const tampered = new NextRequest("https://example.test/api/chat/stage/livekit-webhook", {
      method: "POST",
      headers: { Authorization: real.headers.get("authorization")! },
      body: JSON.stringify(started("EV_3", "chat-social")),
    });
    expect((await webhook(tampered)).status).toBe(401);
    const bare = new NextRequest("https://example.test/api/chat/stage/livekit-webhook", { method: "POST", body: JSON.stringify(started("EV_4")) });
    expect((await webhook(bare)).status).toBe(401);
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("ignores LiveKit rooms that are not a chat room's", async () => {
    for (const room of ["some-other-app", "chat-nowhere", "main"]) expect((await webhook(await signed(started(`EV_${room}`, room)))).status).toBe(200);
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("acts on a repeated event once", async () => {
    expect((await webhook(await signed(started("EV_dup")))).status).toBe(200);
    expect((await webhook(await signed(started("EV_dup")))).status).toBe(200);
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    expect(mocks.notice).toHaveBeenCalledTimes(1);
  });
  it("#503: asks for the room's notice to be checked on the broadcast coming or going, never for a viewer, another app or a forgery", async () => {
    const event = (id: string, name: string, identity: string, room = "chat-main") => ({ event: name, id, room: { name: room }, participant: { identity } });
    mocks.lk.ingresses = live(true);
    expect((await webhook(await signed(event("N1", "track_published", "stage-broadcast")))).status).toBe(200);
    mocks.lk.ingresses = live(false);
    expect((await webhook(await signed(event("N2", "participant_left", "stage-broadcast")))).status).toBe(200);
    mocks.lk.ingresses = live(true);
    expect((await webhook(await signed(started("N3")))).status).toBe(200);
    expect(mocks.notice.mock.calls.map((call) => call[0])).toEqual(["main", "main", "main"]);
    // No admin is behind a webhook.
    expect(mocks.notice.mock.calls.every((call) => call[2] === undefined)).toBe(true);
    mocks.notice.mockClear();
    for (const sent of [event("N4", "participant_joined", "member-bob#00000001"), event("N5", "track_published", "stage-broadcast", "some-other-app")])
      expect((await webhook(await signed(sent))).status).toBe(200);
    expect((await webhook(await signed(started("N6"), "some-other-secret-0123456789abcdef0123"))).status).toBe(401);
    expect(mocks.notice).not.toHaveBeenCalled();
  });
  it("does not exist without the LiveKit settings", async () => {
    const request = await signed(started("EV_5"));
    delete process.env.LIVEKIT_API_KEY;
    expect((await webhook(request)).status).toBe(404);
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});
