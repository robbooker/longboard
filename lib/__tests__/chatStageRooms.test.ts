// #524: the rooms that offer live video (one list, lib/chatStageLive.ts), enforced on every stage
// route that names a room, and the admin's recording-link route. LiveKit, sign-in, the database and
// Ably are all faked.
//  - Gainers, What's New and the announcement and recording rooms: no status asked of LiveKit, no
//    key made, no token, no hand, no stock on screen, no notice attempted;
//  - the ten rooms on the list (Booker Stock Club and, #537, Webinars among them) work as before;
//  - recording: chat admins only, browser sign-in only, same origin, a stage room, a real notice id,
//    a YouTube or Loom link only (stored rebuilt from its video id), never cached.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { StageIngress } from "@/lib/chatStageVideo";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  publish: vi.fn(),
  publishNow: vi.fn(),
  lk: { ingresses: [] as StageIngress[], calls: [] as string[] },
  rpc: vi.fn(),
  after: vi.fn(),
}));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: mocks.after }));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: mocks.auth }));
vi.mock("@/lib/chatAdmin", () => ({ createChatAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/chatMembers", () => ({ findChatMember: async () => ({ id: "member-alice", display_name: "Alice" }) }));
vi.mock("@/lib/chatRealtimePublish", () => ({ publishRoomEventAfterResponse: mocks.publish, publishRoomEvent: mocks.publishNow }));
vi.mock("@/lib/chatStageLiveKit", async (original) => ({
  ...(await original<typeof import("@/lib/chatStageLiveKit")>()),
  stageVideoApi: () => ({
    ingresses: async (room: string) => (mocks.lk.calls.push(`list:${room}`), mocks.lk.ingresses),
    createIngress: async (room: string) => {
      mocks.lk.calls.push(`create:${room}`);
      const ingress = { id: "IN_1", url: "rtmps://fake.livekit.test/x", streamKey: "FAKE-STREAM-KEY-not-real", publishing: false };
      mocks.lk.ingresses = [ingress];
      return ingress;
    },
    deleteIngress: async (id: string) => void mocks.lk.calls.push(`delete:${id}`),
    roomMetadata: async (room: string) => (mocks.lk.calls.push(`metadata:${room}`), null),
    setRoomMetadata: async (room: string) => void mocks.lk.calls.push(`setMetadata:${room}`),
    viewerToken: async () => "token",
    viewer: async () => null,
    removeViewer: async () => false,
    closeRoom: async (room: string) => void mocks.lk.calls.push(`close:${room}`),
    videoRooms: async () => [],
  }),
  stageHandApi: () => ({ participants: async (room: string) => (mocks.lk.calls.push(`participants:${room}`), []), setHand: async () => true }),
}));
import { GET as status } from "@/app/api/chat/stage/status/route";
import { POST as token } from "@/app/api/chat/stage/token/route";
import { GET as liveGet, POST as livePost } from "@/app/api/chat/stage/live/route";
import { POST as onScreenPost } from "@/app/api/chat/stage/on-screen/route";
import { POST as handPost } from "@/app/api/chat/stage/hand/route";
import { POST as recordingPost } from "@/app/api/chat/stage/recording/route";
import { GET as stockGet } from "@/app/api/chat/stage/stock/route";
import { STAGE_ROOMS, isStageRoom } from "@/lib/chatStageLive";
import { stageNoticeAfterResponse } from "@/lib/chatStageNotifyServer";
import { forgetStageState } from "@/lib/chatStageVideo";
import { CHAT_ROOMS, type ChatRoom } from "@/lib/publicChat";

const admin = (over: Record<string, unknown> = {}) => ({
  ok: true,
  user: { id: "acct-alice", email: "alice@example.test", role: "admin" },
  access: { longboard: true, boardroom: true, shortscout: true, shortscoutMember: true, admin: true },
  serverSession: false,
  ...over,
});
const get = (path: string) => new NextRequest(`https://example.test${path}`);
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`https://example.test${path}`, { method: "POST", headers: { "Content-Type": "application/json", origin: "https://example.test", host: "example.test", ...headers }, body: JSON.stringify(body) });
const NOT_OFFERED = CHAT_ROOMS.map((room) => room.slug).filter((room) => !STAGE_ROOMS.includes(room));
const NOTICE = "0b0e7a52-8d0e-4d5e-9d39-0c1f7c1f2a11";

beforeEach(() => {
  vi.clearAllMocks();
  forgetStageState();
  mocks.lk.ingresses = [];
  mocks.lk.calls = [];
  mocks.auth.mockResolvedValue(admin());
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  process.env.LIVEKIT_URL = "wss://fake.livekit.test";
  process.env.LIVEKIT_API_KEY = "APIfakekey";
  process.env.LIVEKIT_API_SECRET = "fake-secret-never-real-0123456789abcdef";
  delete process.env.CHAT_STAGE_MODE;
});

describe("the list", () => {
  it("is the conversation rooms and Booker Stock Club, and nothing else", () => {
    expect([...STAGE_ROOMS].sort()).toEqual(["admins", "ai-insights", "club", "developers", "lb-review", "main", "runner-watch", "shortscout", "social", "webinars"]);
    expect(NOT_OFFERED.sort()).toEqual(["club-recordings", "gainers", "lb-announcements", "lb-recordings", "ss-announcements", "ss-recordings", "whats-new"]);
    for (const room of STAGE_ROOMS) expect(CHAT_ROOMS.some((known) => known.slug === room), room).toBe(true);
    for (const value of [null, undefined, "", "nowhere", 7, ["main"]]) expect(isStageRoom(value)).toBe(false);
  });
});

describe("a room that does not offer live video", () => {
  it.each(NOT_OFFERED)("%s: every stage route refuses, even for an admin, and LiveKit is asked nothing", async (room) => {
    // The room's status is simply off (an older page may still ask).
    expect(await (await status(get(`/api/chat/stage/status?room=${room}`))).json()).toEqual({ state: "off", video: false });
    // Dual, Quad and Six: the room is left out.
    expect(await (await status(get(`/api/chat/stage/status?rooms=${room},main`))).json()).toEqual({ states: { main: "off" }, video: true });
    expect(mocks.lk.calls).toEqual(["list:chat-main"]);
    mocks.lk.calls = [];
    for (const response of [
      await liveGet(get(`/api/chat/stage/live?room=${room}`)),
      await livePost(post("/api/chat/stage/live", { room, action: "open" })),
      await livePost(post("/api/chat/stage/live", { room, action: "reset" })),
      await livePost(post("/api/chat/stage/live", { room, action: "refresh" })),
      await token(post("/api/chat/stage/token", { room })),
      await onScreenPost(post("/api/chat/stage/on-screen", { room, symbol: "APUS" })),
      await handPost(post("/api/chat/stage/hand", { room, raised: true, identity: "member-alice#abcd1234" })),
      await recordingPost(post("/api/chat/stage/recording", { room, message: NOTICE, url: "https://youtu.be/dQw4w9WgXcQ" })),
      await stockGet(get(`/api/chat/stage/stock?room=${room}&ticker=APUS`)),
    ]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "stage_not_offered" });
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
    // No key was made, nothing was read, the room was told nothing, the database was not touched.
    expect(mocks.lk.calls).toEqual([]);
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("no notice is attempted there, whatever hints (a webhook for a key made before this rule)", () => {
    const api = { ingresses: vi.fn() } as never;
    for (const room of NOT_OFFERED) stageNoticeAfterResponse(room as ChatRoom, api);
    expect(mocks.after).not.toHaveBeenCalled();
    stageNoticeAfterResponse("club", api);
    expect(mocks.after).toHaveBeenCalledTimes(1);
  });
});

describe("a room that offers it", () => {
  it.each([...STAGE_ROOMS])("%s: status, key and token work", async (room) => {
    expect(await (await status(get(`/api/chat/stage/status?room=${room}`))).json()).toEqual({ state: "off", video: true, onScreen: null });
    const opened = await livePost(post("/api/chat/stage/live", { room, action: "open" }));
    expect(opened.status).toBe(200);
    expect(mocks.lk.calls).toContain(`create:chat-${room}`);
    forgetStageState();
    mocks.lk.ingresses = [{ id: "IN_1", url: "rtmps://fake.livekit.test/x", streamKey: "FAKE-STREAM-KEY-not-real", publishing: true }];
    expect((await token(post("/api/chat/stage/token", { room }))).status).toBe(200);
  });
});

describe("POST /api/chat/stage/recording", () => {
  const send = (body: unknown, headers?: Record<string, string>) => recordingPost(post("/api/chat/stage/recording", body, headers));
  it("an admin adds a link: stored rebuilt from the video id, the notice rewritten, the room told, nobody notified", async () => {
    const response = await send({ room: "club", message: NOTICE, url: " https://youtu.be/dQw4w9WgXcQ?si=tracking&t=90 " });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s" });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.rpc.mock.calls).toEqual([
      [
        "chat_stage_broadcast_recording",
        {
          p_id: NOTICE,
          p_room: "club",
          p_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s",
          p_body: "The live video in Booker Stock Club has ended. Watch the recording: https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s",
          p_source: "admin",
          p_only_if_empty: false,
        },
      ],
    ]);
    expect(mocks.publishNow.mock.calls).toEqual([["club", { kind: "changed", topics: ["history"] }]]);
  });
  it("a Loom link, and removing the link", async () => {
    await send({ room: "main", message: NOTICE, url: "https://www.loom.com/share/0123456789abcdef0123456789abcdef?sid=x" });
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_url: "https://www.loom.com/share/0123456789abcdef0123456789abcdef" });
    mocks.rpc.mockClear();
    expect((await send({ room: "main", message: NOTICE, url: null })).status).toBe(200);
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_url: null, p_body: "The live video in LB has ended. The recording will follow.", p_source: "admin" });
  });
  it("refuses anything that is not a YouTube or Loom video link", async () => {
    for (const url of ["", "hello", "https://example.test/video", "https://vimeo.com/123456", "javascript:alert(1)", "https://www.youtube.com/playlist?list=PL123", "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ", 7, undefined, { href: "https://youtu.be/dQw4w9WgXcQ" }]) {
      const response = await send({ room: "main", message: NOTICE, url });
      expect(response.status, String(url)).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_link" });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("admins only, signed in through the browser, from this site, for a room and a notice that are named", async () => {
    expect((await send({ room: "main", message: NOTICE, url: "https://youtu.be/dQw4w9WgXcQ" }, { origin: "https://evil.test" })).status).toBe(403);
    mocks.auth.mockResolvedValue({ ok: false, status: 401, error: "unauthenticated" });
    expect((await send({ room: "main", message: NOTICE, url: null })).status).toBe(401);
    for (const who of [
      admin({ user: { id: "acct-bob", email: "bob@example.test", role: "user" }, access: { longboard: true, boardroom: true, admin: false } }),
      admin({ apiToken: { id: "token" } }),
      admin({ agent: { id: "agent" } }),
    ]) {
      mocks.auth.mockResolvedValue(who);
      const response = await send({ room: "main", message: NOTICE, url: "https://youtu.be/dQw4w9WgXcQ" });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "admin_only" });
    }
    mocks.auth.mockResolvedValue(admin());
    // #522: the body must be a JSON object that names its room as text; a missing room never means LB.
    for (const body of [null, [], "x", 5, {}, { message: NOTICE, url: null }, { room: 7, message: NOTICE, url: null }, { room: "", message: NOTICE, url: null }, { room: ["main"], message: NOTICE, url: null }, { room: "nowhere", message: NOTICE, url: null }]) {
      const response = await send(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_room" });
    }
    // #522: the stricter origin check: no Origin, Sec-Fetch-Site or Referer at all is refused; another site's is too.
    const bare = new NextRequest("https://example.test/api/chat/stage/recording", { method: "POST", headers: { "Content-Type": "application/json", host: "example.test" }, body: JSON.stringify({ room: "main", message: NOTICE, url: null }) });
    expect((await recordingPost(bare)).status).toBe(403);
    expect((await send({ room: "main", message: NOTICE, url: null }, { origin: "null" })).status).toBe(403);
    for (const message of [undefined, "", "not-a-uuid", 5, `${NOTICE} or 1=1`]) expect((await send({ room: "main", message, url: null })).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("a message that is not an ended notice of that room is refused, and a database failure is not a success", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    const response = await send({ room: "main", message: NOTICE, url: "https://youtu.be/dQw4w9WgXcQ" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "not_ended_notice" });
    expect(mocks.publishNow).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    expect((await send({ room: "main", message: NOTICE, url: null })).status).toBe(503);
  });
});
