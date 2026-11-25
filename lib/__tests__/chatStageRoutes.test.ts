// #502: the live video API routes, with LiveKit, sign-in, the database and Ably all faked.
//  - status: only for someone who can read the room; nothing asked of LiveKit when it is not set up;
//  - token: the room check, members only while live, watch-only, browser sign-in only, rate limited;
//  - live (start/end, address and key): chat admins only, and the key never reaches anyone else;
//  - livekit-webhook: only a genuinely signed call counts; other rooms and repeats are ignored.
// #507:
//  - on-screen (the host sets or clears the stock): chat admins only, a real ticker only, only while
//    started; kept in the LiveKit room's metadata; this server's memory is dropped and the room told;
//  - status carries what is on screen; stock answers only Polygon's numbers for one clean ticker.
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
  lk: { ingresses: [] as StageIngress[], calls: [] as string[], fail: false, metadata: new Map<string, string>(), failMetadata: false },
  quotes: vi.fn(),
  shares: vi.fn(),
}));
vi.mock("@/lib/chatGainersQuotes", () => ({ gainersQuotes: mocks.quotes }));
vi.mock("@/lib/chatGainersShares", () => ({ gainersShares: mocks.shares }));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: mocks.auth }));
vi.mock("@/lib/chatAdmin", () => ({ createChatAdminClient: () => ({}), requestOriginAllowed: (req: NextRequest) => req.headers.get("origin") !== "https://evil.test" }));
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
      const ingress = { id: "IN_1", url: "rtmps://fake.livekit.test/x", streamKey: "FAKE-STREAM-KEY-not-real", publishing: false };
      mocks.lk.ingresses = [ingress];
      return ingress;
    },
    deleteIngress: async (id: string) => {
      mocks.lk.calls.push(`delete:${id}`);
      mocks.lk.ingresses = [];
    },
    deleteRoom: async (room: string) => {
      mocks.lk.calls.push(`deleteRoom:${room}`);
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
    viewerToken: async (room: string, identity: string, name: string) => `token|${room}|${identity}|${name}`,
  }),
}));
import { GET as status } from "@/app/api/chat/stage/status/route";
import { POST as token } from "@/app/api/chat/stage/token/route";
import { GET as liveGet, POST as livePost } from "@/app/api/chat/stage/live/route";
import { POST as webhook } from "@/app/api/chat/stage/livekit-webhook/route";
import { POST as onScreenPost } from "@/app/api/chat/stage/on-screen/route";
import { GET as stockGet } from "@/app/api/chat/stage/stock/route";
import { forgetStageState, forgetStageWebhooks } from "@/lib/chatStageVideo";

const access = { longboard: true, boardroom: true, shortscout: false, admin: false };
const member = (over: Record<string, unknown> = {}) => ({ ok: true, user: { id: "acct-bob", email: "bob@example.test", role: "user" }, access, serverSession: false, ...over });
const admin = () => ({ ok: true, user: { id: "acct-alice", email: "alice@example.test", role: "admin" }, access: { ...access, admin: true }, serverSession: false });
const outsider = () => member({ access: { longboard: false, shortscout: false, shortscoutMember: true, admin: false } }); // Social, not LB
const get = (path: string) => new NextRequest(`https://example.test${path}`);
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`https://example.test${path}`, { method: "POST", headers: { "Content-Type": "application/json", origin: "https://example.test", host: "example.test", ...headers }, body: JSON.stringify(body) });
const live = (publishing: boolean): StageIngress[] => [{ id: "IN_1", url: "rtmps://fake.livekit.test/x", streamKey: FAKE_STREAM_KEY, publishing }];

beforeEach(() => {
  vi.clearAllMocks();
  forgetStageState();
  forgetStageWebhooks();
  mocks.lk.ingresses = [];
  mocks.lk.calls = [];
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
  it("says off, waiting or live, and is never cached by a browser or CDN", async () => {
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
  it("answers off when LiveKit cannot be reached", async () => {
    mocks.lk.fail = true;
    expect(await (await status(get("/api/chat/stage/status?room=main"))).json()).toEqual({ state: "off", video: true, onScreen: null });
  });
  it("#507: carries the stock on screen while started, and asks LiveKit nothing more for a room that is off", async () => {
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
  it("sets it for an admin: saved in the LiveKit room, uncached, the room told with the ticker, and the next status has it", async () => {
    mocks.auth.mockResolvedValue(admin());
    mocks.lk.ingresses = live(true);
    // This server remembers "nothing on screen" from a moment ago.
    expect((await (await status(get("/api/chat/stage/status?room=main"))).json()).onScreen).toBeNull();
    mocks.lk.calls = [];
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
  it("only while the live video is started; says so when LiveKit is down or not set up", async () => {
    mocks.auth.mockResolvedValue(admin());
    const off = await set("APUS");
    expect(off.status).toBe(409);
    expect(await off.json()).toEqual({ error: "not_started" });
    expect(mocks.lk.metadata.size).toBe(0);
    mocks.lk.ingresses = live(true);
    mocks.lk.failMetadata = true;
    expect((await set("APUS")).status).toBe(502);
    expect(mocks.publish).not.toHaveBeenCalled();
    delete process.env.LIVEKIT_API_SECRET;
    expect((await set("APUS")).status).toBe(404);
  });
});

describe("GET /api/chat/stage/stock (#507)", () => {
  const gainers = () => member();
  it("answers Polygon's numbers for one ticker, and nothing more", async () => {
    mocks.auth.mockResolvedValue(gainers());
    const response = await stockGet(get("/api/chat/stage/stock?ticker=FRSH"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ ticker: "FRSH", quote: { price: 10, changePct: 100, volume: 12_345_678 }, sharesOutstanding: 120_000_000 });
    expect(await (await stockGet(get("/api/chat/stage/stock?ticker=ZZZT"))).json()).toEqual({ ticker: "ZZZT", quote: null, sharesOutstanding: null });
    // Polygon down: dashes, not an error page.
    mocks.quotes.mockRejectedValue(new Error("down"));
    mocks.shares.mockRejectedValue(new Error("down"));
    expect(await (await stockGet(get("/api/chat/stage/stock?ticker=FRSH"))).json()).toEqual({ ticker: "FRSH", quote: null, sharesOutstanding: null });
  });
  it("needs a sign-in, the Gainers room and one clean ticker", async () => {
    mocks.auth.mockResolvedValue({ ok: false, status: 401, error: "unauthenticated" });
    expect((await stockGet(get("/api/chat/stage/stock?ticker=FRSH"))).status).toBe(401);
    mocks.auth.mockResolvedValue(member({ access: { longboard: false, boardroom: false, shortscout: false, admin: false } }));
    expect((await stockGet(get("/api/chat/stage/stock?ticker=FRSH"))).status).toBe(403);
    mocks.auth.mockResolvedValue(gainers());
    for (const bad of ["", "frsh", "FRSH,AEHL", "TOOLONG", "A1", "%24FRSH", "BRK-B"]) expect((await stockGet(get(`/api/chat/stage/stock?ticker=${bad}`))).status).toBe(400);
    expect((await stockGet(get("/api/chat/stage/stock"))).status).toBe(400);
    expect(mocks.quotes).not.toHaveBeenCalled();
    expect(mocks.shares).not.toHaveBeenCalled();
  });
});

describe("POST /api/chat/stage/token", () => {
  const ask = (room = "main", headers = {}) => token(post("/api/chat/stage/token", { room }, headers));
  it("gives a member of a live room a watch token named for them", async () => {
    mocks.lk.ingresses = live(true);
    const response = await ask();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.url).toBe("wss://fake.livekit.test");
    expect(body.token).toMatch(/^token\|chat-main\|member-bob#[0-9a-f]{8}\|Bob Test$/);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(mocks.member).toHaveBeenCalledWith(expect.anything(), "acct-bob");
  });
  it("refuses a member while the room is not live", async () => {
    expect((await ask()).status).toBe(409);
    forgetStageState();
    mocks.lk.ingresses = live(false);
    const waiting = await ask();
    expect(waiting.status).toBe(409);
    expect((await waiting.json()).token).toBeUndefined();
  });
  it("lets an admin into a started room to wait for the broadcast, but not a room that is off", async () => {
    mocks.auth.mockResolvedValue(admin());
    expect((await ask()).status).toBe(409);
    forgetStageState();
    mocks.lk.ingresses = live(false);
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
  it("refuses a signed-out caller, another site, an API token, an agent and a bot", async () => {
    mocks.lk.ingresses = live(true);
    expect((await ask("main", { origin: "https://evil.test" })).status).toBe(403);
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

describe("/api/chat/stage/live (start, end, the stream address and key)", () => {
  const act = (action: string, headers = {}) => livePost(post("/api/chat/stage/live", { room: "main", action }, headers));
  it("never tells a member anything, and changes nothing for them", async () => {
    mocks.lk.ingresses = live(true);
    for (const response of [await liveGet(get("/api/chat/stage/live?room=main")), await act("start"), await act("end"), await act("refresh")]) {
      expect(response.status).toBe(403);
      const text = JSON.stringify(await response.json());
      expect(text).toBe('{"error":"admin_only"}');
      expect(text).not.toContain(FAKE_STREAM_KEY);
    }
    expect(mocks.lk.calls).toEqual([]);
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("refuses an admin's API token, an agent, a signed-out caller and another site", async () => {
    mocks.auth.mockResolvedValue({ ...admin(), apiToken: true });
    expect((await liveGet(get("/api/chat/stage/live?room=main"))).status).toBe(403);
    expect((await act("start")).status).toBe(403);
    mocks.auth.mockResolvedValue({ ...admin(), agent: { id: "a" } });
    expect((await act("start")).status).toBe(403);
    mocks.auth.mockResolvedValue({ ok: false, status: 401, error: "unauthenticated" });
    expect((await act("start")).status).toBe(401);
    mocks.auth.mockResolvedValue(admin());
    expect((await act("start", { origin: "https://evil.test" })).status).toBe(403);
    expect(mocks.lk.calls).toEqual([]);
  });
  it("starts for an admin: the address and key, uncached, and a signal that carries neither", async () => {
    mocks.auth.mockResolvedValue(admin());
    const response = await act("start");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: "waiting", address: "rtmps://fake.livekit.test/x", streamKey: FAKE_STREAM_KEY });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.lk.calls).toEqual(["list:chat-main", "create:chat-main"]);
    expect(mocks.publish).toHaveBeenCalledExactlyOnceWith("main", { kind: "changed", topics: ["stage"] });
    expect(JSON.stringify(mocks.publish.mock.calls)).not.toContain(FAKE_STREAM_KEY);
    // Starting again reuses it; reading it back shows the same key.
    await act("start");
    expect(mocks.lk.calls.filter((call) => call.startsWith("create"))).toHaveLength(1);
    expect(await (await liveGet(get("/api/chat/stage/live?room=main"))).json()).toMatchObject({ streamKey: FAKE_STREAM_KEY });
  });
  it("ends for an admin: the ingress and the room are deleted and the room is told", async () => {
    mocks.auth.mockResolvedValue(admin());
    mocks.lk.ingresses = live(true);
    const response = await act("end");
    expect(await response.json()).toEqual({ state: "off" });
    expect(mocks.lk.calls).toEqual(["list:chat-main", "delete:IN_1", "deleteRoom:chat-main"]);
    expect(mocks.publish).toHaveBeenCalledExactlyOnceWith("main", { kind: "changed", topics: ["stage"] });
    expect(await (await liveGet(get("/api/chat/stage/live?room=main"))).json()).toEqual({ state: "off" });
  });
  it("#503: start, end and the player's refresh each ask for the room's notice to be checked, as that admin; nothing else does", async () => {
    mocks.auth.mockResolvedValue(admin());
    for (const action of ["start", "refresh", "end"]) expect((await act(action)).status).toBe(200);
    expect(mocks.notice.mock.calls.map((call) => [call[0], call[2]])).toEqual([["main", "acct-alice"], ["main", "acct-alice"], ["main", "acct-alice"]]);
    mocks.notice.mockClear();
    await liveGet(get("/api/chat/stage/live?room=main"));
    await status(get("/api/chat/stage/status?room=main"));
    expect((await act("nonsense")).status).toBe(400);
    mocks.auth.mockResolvedValue(member());
    for (const action of ["start", "refresh", "end"]) expect((await act(action)).status).toBe(403);
    await token(post("/api/chat/stage/token", { room: "main" }));
    expect(mocks.notice).not.toHaveBeenCalled();
  });
  it("is off without the LiveKit settings, and says so when LiveKit fails", async () => {
    mocks.auth.mockResolvedValue(admin());
    expect((await act("nonsense")).status).toBe(400);
    mocks.lk.fail = true;
    expect((await act("start")).status).toBe(502);
    delete process.env.LIVEKIT_URL;
    expect((await act("start")).status).toBe(404);
    expect((await liveGet(get("/api/chat/stage/live?room=main"))).status).toBe(404);
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
  it("handles the broadcast arriving and leaving, and ignores viewers", async () => {
    const events = [
      { event: "track_published", id: "EV_a", room: { name: "chat-main" }, participant: { identity: "stage-broadcast" } },
      { event: "participant_left", id: "EV_b", room: { name: "chat-main" }, participant: { identity: "stage-broadcast" } },
      { event: "room_started", id: "EV_c", room: { name: "chat-social" } },
      { event: "room_finished", id: "EV_d", room: { name: "chat-social" } },
      { event: "ingress_ended", id: "EV_e", ingressInfo: { roomName: "chat-main" } },
    ];
    for (const event of events) expect((await webhook(await signed(event))).status).toBe(200);
    expect(mocks.publish.mock.calls.map((call) => call[0])).toEqual(["main", "main", "social", "social", "main"]);
    mocks.publish.mockClear();
    for (const event of [
      { event: "participant_joined", id: "EV_f", room: { name: "chat-main" }, participant: { identity: "member-bob#ab12cd34" } },
      { event: "participant_left", id: "EV_g", room: { name: "chat-main" }, participant: { identity: "member-bob#ab12cd34" } },
      { event: "track_published", id: "EV_h", room: { name: "chat-main" }, participant: { identity: "someone-else" } },
    ])
      expect((await webhook(await signed(event))).status).toBe(200);
    expect(mocks.publish).not.toHaveBeenCalled();
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
    for (const sent of [event("N1", "track_published", "stage-broadcast"), event("N2", "participant_left", "stage-broadcast"), started("N3")])
      expect((await webhook(await signed(sent))).status).toBe(200);
    expect(mocks.notice.mock.calls.map((call) => call[0])).toEqual(["main", "main", "main"]);
    // No admin is behind a webhook.
    expect(mocks.notice.mock.calls.every((call) => call[2] === undefined)).toBe(true);
    mocks.notice.mockClear();
    for (const sent of [event("N4", "participant_joined", "member-bob#ab12cd34"), event("N5", "track_published", "stage-broadcast", "some-other-app")])
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
