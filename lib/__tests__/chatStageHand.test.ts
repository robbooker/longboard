// #508 Raise hand: the shared rules (whose identity, the order, one hand per member), the hand
// route with LiveKit, sign-in and the database all faked, the real LiveKit calls against a fake
// client, and the page's store of hands. No LiveKit is reached.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { StageHandParticipant } from "@/lib/chatStageHand";
import type { StageFeedConnect, StageFeedEvents } from "@/components/chat/stage/stageFeed";

const KEY = "APIfakekey";
const SECRET = "fake-secret-never-real-0123456789abcdef";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  member: vi.fn(),
  lk: {
    publishing: true,
    started: true,
    fail: false,
    calls: [] as string[],
    // The fake LiveKit room: identity -> its name and attributes.
    people: new Map<string, { name: string; attributes: Record<string, string> }>(),
    options: [] as unknown[],
  },
}));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: mocks.auth }));
vi.mock("@/lib/chatAdmin", () => ({ createChatAdminClient: () => ({}), requestOriginAllowed: (req: NextRequest) => req.headers.get("origin") !== "https://evil.test" }));
vi.mock("@/lib/chatMembers", () => ({ findChatMember: mocks.member }));
const twirp = (code: string, status: number) => Object.assign(new Error(code), { code, status });
vi.mock("livekit-server-sdk", async (original) => ({
  ...(await original<typeof import("livekit-server-sdk")>()),
  IngressClient: class {
    async listIngress() {
      mocks.lk.calls.push("listIngress");
      if (mocks.lk.fail) throw twirp("unavailable", 503);
      return mocks.lk.started ? [{ ingressId: "IN_1", url: "rtmps://fake.livekit.test/x", streamKey: "FAKE", roomName: "chat-main", state: { status: mocks.lk.publishing ? 2 : 0 } }] : [];
    }
  },
  RoomServiceClient: class {
    constructor(public host: string) {}
    async listParticipants(room: string) {
      mocks.lk.calls.push(`list:${room}`);
      if (mocks.lk.fail) throw twirp("unavailable", 503);
      if (room !== "chat-main") throw twirp("not_found", 404);
      return [...mocks.lk.people].map(([identity, person]) => ({ identity, name: person.name, attributes: { ...person.attributes } }));
    }
    async updateParticipant(room: string, identity: string, options: { attributes?: Record<string, string> }) {
      mocks.lk.calls.push(`update:${room}:${identity}`);
      mocks.lk.options.push(options);
      if (mocks.lk.fail) throw twirp("unavailable", 503);
      const person = room === "chat-main" ? mocks.lk.people.get(identity) : undefined;
      if (!person) throw twirp("not_found", 404);
      // As LiveKit does: an attribute set to "" is removed.
      for (const [key, value] of Object.entries(options.attributes ?? {})) {
        if (value) person.attributes[key] = value;
        else delete person.attributes[key];
      }
      return {};
    }
  },
}));
import { POST as handPost } from "@/app/api/chat/stage/hand/route";
import {
  isStageViewerIdentity,
  parseStageHandAt,
  stageHandAgo,
  stageHandAttributes,
  stageHandCountLabel,
  stageHandIsOwn,
  stageHands,
} from "@/lib/chatStageHand";
import { stageViewerGrant } from "@/lib/chatStageLiveKit";
import { forgetStageState, stageViewerIdentity } from "@/lib/chatStageVideo";
import { noStageHands, stageHandsSnapshot, stageTokenViewer, subscribeStageHands, withStageHands } from "@/components/chat/stage/stageHandStore";

const BOB = "member-bob#0000000a";
const BOB_PHONE = "member-bob#0000000b";
const CARA = "member-cara#0000000c";
const DAN = "member-dan#0000000d";
const access = { longboard: true, boardroom: true, shortscout: false, admin: false };
const member = (over: Record<string, unknown> = {}) => ({ ok: true, user: { id: "acct-bob", email: "bob@example.test", role: "user" }, access, serverSession: false, ...over });
const admin = () => ({ ok: true, user: { id: "acct-alice", email: "alice@example.test", role: "admin" }, access: { ...access, admin: true }, serverSession: false });
const post = (body: unknown, headers: Record<string, string> = {}) =>
  handPost(new NextRequest("https://example.test/api/chat/stage/hand", { method: "POST", headers: { "Content-Type": "application/json", origin: "https://example.test", host: "example.test", ...headers }, body: JSON.stringify(body) }));
const join = (identity: string, name: string, hand?: number) => mocks.lk.people.set(identity, { name, attributes: hand ? { hand: String(hand) } : {} });
const handOf = (identity: string) => mocks.lk.people.get(identity)?.attributes.hand;
const updates = () => mocks.lk.calls.filter((call) => call.startsWith("update:"));
let account = 0;
/** A fresh account each time, so one test's presses never use up another's allowance. */
const as = (memberId: string, role: "user" | "admin" = "user") => {
  const id = `acct-${memberId}-${++account}`;
  mocks.auth.mockResolvedValue(role === "admin" ? { ...admin(), user: { id, email: "a@example.test", role: "admin" } } : member({ user: { id, email: "m@example.test", role: "user" } }));
  mocks.member.mockResolvedValue({ id: memberId, display_name: memberId, accepts_requests: true });
};

beforeEach(() => {
  vi.clearAllMocks();
  forgetStageState();
  mocks.lk.publishing = true;
  mocks.lk.started = true;
  mocks.lk.fail = false;
  mocks.lk.calls = [];
  mocks.lk.options = [];
  mocks.lk.people = new Map();
  join(BOB, "Bob Test");
  join(BOB_PHONE, "Bob Test");
  join(CARA, "Cara Test");
  join(DAN, "Dan Test");
  join("stage-broadcast", "Live video");
  as("member-bob");
  process.env.LIVEKIT_URL = "wss://fake.livekit.test";
  process.env.LIVEKIT_API_KEY = KEY;
  process.env.LIVEKIT_API_SECRET = SECRET;
  delete process.env.CHAT_STAGE_MODE;
});

describe("raised hands: the shared rules", () => {
  it("knows a viewer identity, and whose it is", () => {
    expect(isStageViewerIdentity(stageViewerIdentity("7d0c", "0a1b2c3d"))).toBe(true);
    for (const bad of ["stage-broadcast", "member-bob", "member-bob#", "member-bob#XYZ", "member-bob#0000000a#0000000b", "a b#0000000a", "", null, 7])
      expect(isStageViewerIdentity(bad)).toBe(false);
    expect(stageHandIsOwn("member-bob", BOB)).toBe(true);
    expect(stageHandIsOwn("member-bob", CARA)).toBe(false);
    // Someone whose id merely begins the same is someone else.
    expect(stageHandIsOwn("member-bo", BOB)).toBe(false);
    expect(stageHandIsOwn("", "#0000000a")).toBe(false);
  });
  it("reads and writes the attribute", () => {
    expect(stageHandAttributes(1700000000123)).toEqual({ hand: "1700000000123" });
    expect(stageHandAttributes(null)).toEqual({ hand: "" });
    expect(parseStageHandAt("1700000000123")).toBe(1700000000123);
    for (const none of ["", "0", "yes", "-5", "1e9", undefined, 5]) expect(parseStageHandAt(none)).toBeNull();
  });
  it("lists hands oldest first, one per member, never the broadcast", () => {
    const people: StageHandParticipant[] = [
      { identity: DAN, name: "Dan Test", hand: "3000" },
      { identity: BOB_PHONE, name: "Bob Test", hand: "2500" },
      { identity: "stage-broadcast", name: "Live video", hand: "1" },
      { identity: CARA, name: "Cara Test", hand: "2000" },
      { identity: BOB, name: "Bob Test", hand: "1000" },
      { identity: "member-eve#0000000e", name: "Eve Test" },
      { identity: "member-fay#0000000f", name: "Fay Test", hand: "" },
    ];
    expect(stageHands(people)).toEqual([
      { member: "member-bob", name: "Bob Test", at: 1000, identities: [BOB_PHONE, BOB] },
      { member: "member-cara", name: "Cara Test", at: 2000, identities: [CARA] },
      { member: "member-dan", name: "Dan Test", at: 3000, identities: [DAN] },
    ]);
    expect(stageHands([])).toEqual([]);
    // The same moment: a steady order.
    expect(stageHands([{ identity: DAN, name: "D", hand: "5" }, { identity: CARA, name: "C", hand: "5" }]).map((hand) => hand.member)).toEqual(["member-cara", "member-dan"]);
  });
  it("words the count and how long ago", () => {
    expect([1, 2, 30].map(stageHandCountLabel)).toEqual(["1 hand up", "2 hands up", "30 hands up"]);
    const at = 1_000_000;
    expect([0, 9_000, 45_000, 60_000, 185_000, 3_600_000, 3_900_000, -5_000].map((later) => stageHandAgo(at, at + later))).toEqual([
      "just now", "just now", "45 sec ago", "1 min ago", "3 min ago", "1 hr ago", "1 hr 5 min ago", "just now",
    ]);
  });
  it("a viewer's token still cannot change their own details or send data", () => {
    expect(stageViewerGrant("chat-main")).toMatchObject({ canPublish: false, canPublishData: false, canUpdateOwnMetadata: false });
  });
});

describe("POST /api/chat/stage/hand", () => {
  it("raises a member's own hand in a live room, saved on their LiveKit participant", async () => {
    const before = Date.now();
    const response = await post({ room: "main", identity: BOB, raised: true });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.raised).toBe(true);
    expect(body.at).toBeGreaterThanOrEqual(before);
    expect(handOf(BOB)).toBe(String(body.at));
    expect(updates()).toEqual([`update:chat-main:${BOB}`]);
    // Only the hand is touched: no permission, name or metadata.
    expect(mocks.lk.options).toEqual([{ attributes: { hand: String(body.at) } }]);
    expect(handOf(CARA)).toBeUndefined();
  });
  it("lowers it again, in every tab the member named", async () => {
    join(BOB, "Bob Test", 1000);
    join(BOB_PHONE, "Bob Test", 2000);
    const response = await post({ room: "main", identities: [BOB, BOB_PHONE], raised: false });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ raised: false, lowered: 2 });
    expect([handOf(BOB), handOf(BOB_PHONE)]).toEqual([undefined, undefined]);
    // One that has already left is not a failure.
    const gone = await post({ room: "main", identity: "member-bob#000000ff", raised: false });
    expect([gone.status, await gone.json()]).toEqual([200, { raised: false, lowered: 0 }]);
  });
  it("never lets a member raise or lower anyone else's hand", async () => {
    join(CARA, "Cara Test", 1000);
    for (const body of [
      { room: "main", identity: CARA, raised: true },
      { room: "main", identity: DAN, raised: true },
      { room: "main", identity: CARA, raised: false },
      { room: "main", identities: [BOB, CARA], raised: false },
      { room: "main", identity: "member-bobby#0000000a", raised: true },
    ]) {
      const response = await post(body);
      expect([response.status, await response.json()]).toEqual([403, { error: "not_your_hand" }]);
    }
    const all = await post({ room: "main", all: true, raised: false });
    expect([all.status, await all.json()]).toEqual([403, { error: "admin_only" }]);
    expect(mocks.lk.calls).toEqual([]);
    expect(handOf(CARA)).toBe("1000");
    expect(handOf(DAN)).toBeUndefined();
  });
  it("takes only a real room, a clear yes or no, and viewer identities", async () => {
    expect((await post({ room: "nope", identity: BOB, raised: true })).status).toBe(400);
    for (const body of [
      { room: "main", identity: BOB },
      { room: "main", identity: BOB, raised: "yes" },
      { room: "main", raised: true },
      { room: "main", identity: "stage-broadcast", raised: true },
      { room: "main", identity: 5, raised: false },
      { room: "main", identities: [], raised: false },
      { room: "main", identities: [BOB, BOB_PHONE], raised: true },
      { room: "main", identities: Array.from({ length: 21 }, (_, i) => `member-bob#${String(i).padStart(8, "0")}`), raised: false },
    ])
      expect((await post(body)).status, JSON.stringify(body)).toBe(400);
    expect(mocks.lk.calls).toEqual([]);
  });
  it("refuses a hand while the room is not live, but a hand can always come down", async () => {
    join(BOB, "Bob Test", 1000);
    mocks.lk.publishing = false;
    const waiting = await post({ room: "main", identity: BOB_PHONE, raised: true });
    expect([waiting.status, await waiting.json()]).toEqual([409, { error: "not_live", state: "waiting" }]);
    forgetStageState();
    mocks.lk.started = false;
    const off = await post({ room: "main", identity: BOB_PHONE, raised: true });
    expect([off.status, (await off.json()).error]).toEqual([409, "not_live"]);
    expect(updates()).toEqual([]);
    expect((await post({ room: "main", identity: BOB, raised: false })).status).toBe(200);
    expect(handOf(BOB)).toBeUndefined();
  });
  it("lets an admin raise their own hand in a started room, the token route's rule", async () => {
    join("member-alice#000000aa", "Alice Test");
    as("member-alice", "admin");
    mocks.lk.publishing = false;
    expect((await post({ room: "main", identity: "member-alice#000000aa", raised: true })).status).toBe(200);
    forgetStageState();
    mocks.lk.started = false;
    expect((await post({ room: "main", identity: "member-alice#000000aa", raised: true })).status).toBe(409);
    // An admin raises only their own hand too.
    const other = await post({ room: "main", identity: CARA, raised: true });
    expect([other.status, await other.json()]).toEqual([403, { error: "not_your_hand" }]);
  });
  it("says so when the caller is not in the LiveKit room", async () => {
    const response = await post({ room: "main", identity: "member-bob#000000ff", raised: true });
    expect([response.status, await response.json()]).toEqual([409, { error: "not_watching" }]);
  });
  it("lets an admin lower one person's hand, in each of their tabs", async () => {
    join(BOB, "Bob Test", 1000);
    join(BOB_PHONE, "Bob Test", 1500);
    join(CARA, "Cara Test", 2000);
    as("member-alice", "admin");
    const response = await post({ room: "main", identities: [BOB, BOB_PHONE], raised: false });
    expect([response.status, await response.json()]).toEqual([200, { raised: false, lowered: 2 }]);
    expect([handOf(BOB), handOf(BOB_PHONE), handOf(CARA)]).toEqual([undefined, undefined, "2000"]);
  });
  it("lets an admin lower every hand in that room, and only hands", async () => {
    join(BOB, "Bob Test", 1000);
    join(BOB_PHONE, "Bob Test", 1500);
    join(CARA, "Cara Test", 2000);
    as("member-alice", "admin");
    const response = await post({ room: "main", all: true, raised: false });
    expect([response.status, await response.json()]).toEqual([200, { lowered: 3 }]);
    expect([...mocks.lk.people.values()].every((person) => !person.attributes.hand)).toBe(true);
    expect(updates().sort()).toEqual([BOB, BOB_PHONE, CARA].map((identity) => `update:chat-main:${identity}`).sort());
    // "Raise all" does not exist.
    expect((await post({ room: "main", all: true, raised: true })).status).toBe(403);
    // A room nobody is in has no hands to lower.
    const empty = await post({ room: "social", all: true, raised: false });
    expect([empty.status, await empty.json()]).toEqual([200, { lowered: 0 }]);
  });
  it("refuses someone who cannot read the room, a signed-out caller, another site, an API token, an agent and a bot", async () => {
    mocks.auth.mockResolvedValue(member({ access: { longboard: false, shortscout: false, shortscoutMember: true, admin: false } }));
    const outsider = await post({ room: "main", identity: BOB, raised: true });
    expect([outsider.status, await outsider.json()]).toEqual([403, { error: "room_forbidden" }]);
    mocks.auth.mockResolvedValue(member());
    expect((await post({ room: "main", identity: BOB, raised: true }, { origin: "https://evil.test" })).status).toBe(403);
    mocks.auth.mockResolvedValue({ ok: false, status: 401, error: "unauthenticated" });
    expect((await post({ room: "main", identity: BOB, raised: true })).status).toBe(401);
    for (const kind of [{ apiToken: true }, { agent: { id: "a" } }, { access: { ...access, botRooms: ["main"] } }]) {
      mocks.auth.mockResolvedValue(member(kind));
      const response = await post({ room: "main", identity: BOB, raised: true });
      expect([response.status, await response.json()]).toEqual([403, { error: "browser_only" }]);
    }
    as("member-bob");
    mocks.member.mockResolvedValue(null);
    expect((await post({ room: "main", identity: BOB, raised: true })).status).toBe(403);
    expect(mocks.lk.calls).toEqual([]);
    expect(handOf(BOB)).toBeUndefined();
  });
  it("is off when live video is not set up, and says so when LiveKit fails", async () => {
    delete process.env.LIVEKIT_API_SECRET;
    expect((await post({ room: "main", identity: BOB, raised: true })).status).toBe(404);
    process.env.LIVEKIT_API_SECRET = SECRET;
    process.env.CHAT_STAGE_MODE = "off";
    expect((await post({ room: "main", identity: BOB, raised: true })).status).toBe(404);
    delete process.env.CHAT_STAGE_MODE;
    mocks.lk.fail = true;
    const down = await post({ room: "main", identity: BOB, raised: false });
    expect([down.status, await down.json()]).toEqual([502, { error: "livekit_unavailable" }]);
  });
  it("limits one account to 20 presses a minute, and not their neighbour", async () => {
    const answers = [];
    for (let i = 0; i < 22; i++) answers.push((await post({ room: "main", identity: BOB, raised: i % 2 === 0 })).status);
    expect(answers.slice(0, 20).every((code) => code === 200)).toBe(true);
    expect(answers.slice(20)).toEqual([429, 429]);
    as("member-cara");
    expect((await post({ room: "main", identity: CARA, raised: true })).status).toBe(200);
  });
});

describe("the page's store of raised hands", () => {
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const tokenFor = (identity: string, videoRoom = "chat-main") => `${b64({ alg: "HS256" })}.${b64({ sub: identity, name: "Zoë", video: { room: videoRoom, roomJoin: true } })}.sig`;
  const fake = () => {
    const made: { events: StageFeedEvents; closed: number }[] = [];
    const connect: StageFeedConnect = async ({ events }) => {
      const entry = { events, closed: 0 };
      made.push(entry);
      events.hands?.([{ identity: CARA, name: "Cara Test", hand: "2000" }]);
      return { startAudio: async () => undefined, setVolume: () => undefined, close: () => void entry.closed++ };
    };
    return { made, connect };
  };
  const options = (token: string, events: Partial<StageFeedEvents> = {}) => ({
    url: "wss://fake.livekit.test",
    token,
    video: {} as HTMLVideoElement,
    audio: {} as HTMLAudioElement,
    signal: new AbortController().signal,
    events: { video: vi.fn(), viewers: vi.fn(), audioBlocked: vi.fn(), connection: vi.fn(), ...events },
  });

  it("reads the room and the viewer's identity from the token", () => {
    expect(stageTokenViewer(tokenFor(BOB))).toEqual({ videoRoom: "chat-main", identity: BOB });
    for (const bad of ["", "a.b.c", "token|chat-main|x", `${b64({})}.${b64({ sub: BOB })}.sig`]) expect(stageTokenViewer(bad)).toBeNull();
  });
  it("holds a connection's hands from connected until closed, and tells listeners", async () => {
    const { made, connect } = fake();
    let told = 0;
    const stop = subscribeStageHands(() => told++);
    expect(stageHandsSnapshot("chat-main")).toBe(noStageHands());
    const outer = options(tokenFor(BOB));
    const feed = await withStageHands(connect)(outer);
    expect(stageHandsSnapshot("chat-main")).toEqual({ identity: BOB, participants: [{ identity: CARA, name: "Cara Test", hand: "2000" }] });
    expect(stageHandsSnapshot("chat-social")).toBe(noStageHands());
    made[0].events.hands?.([]);
    expect(stageHandsSnapshot("chat-main")).toEqual({ identity: BOB, participants: [] });
    // The player's own events still arrive.
    made[0].events.viewers(4);
    expect(outer.events.viewers).toHaveBeenCalledWith(4);
    const before = told;
    feed.close();
    expect(made[0].closed).toBe(1);
    expect(stageHandsSnapshot("chat-main")).toBe(noStageHands());
    expect(told).toBeGreaterThan(before);
    // Late news from a closed connection changes nothing.
    made[0].events.hands?.([{ identity: BOB, name: "Bob Test", hand: "1" }]);
    expect(stageHandsSnapshot("chat-main")).toBe(noStageHands());
    stop();
  });
  it("forgets the hands when the broadcast ends or the connection is lost: the next connection starts with the hand down", async () => {
    for (const state of ["ended", "failed"] as const) {
      const { made, connect } = fake();
      const outer = options(tokenFor(BOB));
      await withStageHands(connect)(outer);
      made[0].events.hands?.([{ identity: BOB, name: "Bob Test", hand: "1000" }]);
      made[0].events.connection("reconnecting");
      expect(stageHandsSnapshot("chat-main").participants).toHaveLength(1);
      made[0].events.connection(state);
      expect(stageHandsSnapshot("chat-main")).toBe(noStageHands());
      expect(outer.events.connection).toHaveBeenLastCalledWith(state);
      const again = await withStageHands(fake().connect)(options(tokenFor("member-bob#0000000b")));
      expect(stageHandsSnapshot("chat-main").identity).toBe("member-bob#0000000b");
      expect(stageHands(stageHandsSnapshot("chat-main").participants).some((hand) => hand.member === "member-bob")).toBe(false);
      again.close();
    }
  });
  it("an older connection closing late does not wipe the newer one's hands, and a failed connect leaves nothing", async () => {
    const first = await withStageHands(fake().connect)(options(tokenFor(BOB)));
    const second = await withStageHands(fake().connect)(options(tokenFor(BOB_PHONE)));
    first.close();
    expect(stageHandsSnapshot("chat-main").identity).toBe(BOB_PHONE);
    second.close();
    await expect(withStageHands(async () => Promise.reject(new Error("no")))(options(tokenFor(BOB)))).rejects.toThrow("no");
    expect(stageHandsSnapshot("chat-main")).toBe(noStageHands());
  });
});
