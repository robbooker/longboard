// #502: the live video API routes, with LiveKit, sign-in, the database and Ably all faked.
//  - status: only for someone who can read the room; nothing asked of LiveKit when it is not set up;
//  - token: the room check, members only while live, watch-only, browser sign-in only, rate limited;
//  - live (start/end, address and key): chat admins only, and the key never reaches anyone else;
//  - livekit-webhook: only a genuinely signed call counts; other rooms and repeats are ignored.
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
  lk: { ingresses: [] as StageIngress[], calls: [] as string[], fail: false },
}));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: mocks.auth }));
vi.mock("@/lib/chatAdmin", () => ({ createChatAdminClient: () => ({}), requestOriginAllowed: (req: NextRequest) => req.headers.get("origin") !== "https://evil.test" }));
vi.mock("@/lib/chatMembers", () => ({ findChatMember: mocks.member }));
vi.mock("@/lib/chatRealtimePublish", () => ({ publishRoomEventAfterResponse: mocks.publish }));
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
    viewerToken: async (room: string, identity: string, name: string) => `token|${room}|${identity}|${name}`,
  }),
}));
import { GET as status } from "@/app/api/chat/stage/status/route";
import { POST as token } from "@/app/api/chat/stage/token/route";
import { GET as liveGet, POST as livePost } from "@/app/api/chat/stage/live/route";
import { POST as webhook } from "@/app/api/chat/stage/livekit-webhook/route";
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
    expect(await (await status(get("/api/chat/stage/status?room=main"))).json()).toEqual({ state: "off", video: true });
    forgetStageState();
    mocks.lk.ingresses = live(false);
    expect(await (await status(get("/api/chat/stage/status?room=main"))).json()).toEqual({ state: "waiting", video: true });
    forgetStageState();
    mocks.lk.ingresses = live(true);
    const response = await status(get("/api/chat/stage/status?room=main"));
    const body = await response.json();
    expect(body).toEqual({ state: "live", video: true });
    expect(JSON.stringify(body)).not.toContain(FAKE_STREAM_KEY);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("asks LiveKit once for many requests", async () => {
    mocks.lk.ingresses = live(true);
    await Promise.all(Array.from({ length: 25 }, () => status(get("/api/chat/stage/status?room=main"))));
    await status(get("/api/chat/stage/status?room=main"));
    expect(mocks.lk.calls).toEqual(["list:chat-main"]);
  });
  it("answers off when LiveKit cannot be reached", async () => {
    mocks.lk.fail = true;
    expect(await (await status(get("/api/chat/stage/status?room=main"))).json()).toEqual({ state: "off", video: true });
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
  });
  it("does not exist without the LiveKit settings", async () => {
    const request = await signed(started("EV_5"));
    delete process.env.LIVEKIT_API_KEY;
    expect((await webhook(request)).status).toBe(404);
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});
