// #502 Stage mode's live video: settings, names, the "is it live" memory, the room's permanent
// stream key (#512: made once, reused for good, reset on request), who may open
// the stage, the viewer token's grants and the realtime signal. No LiveKit is reached: the token is
// signed locally with made-up keys and everything else runs against a fake StageVideoApi.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  STAGE_STATE_MEMORY_MS,
  chatRoomOfStageVideoRoom,
  forgetStageState,
  readStageOnScreen,
  readStageKey,
  readStageState,
  resetStageKey,
  setStageOnScreen,
  sharedStageOnScreen,
  sharedStageState,
  STAGE_NOTICE_CHECK_MS,
  stageIngressOf,
  stageKeyFor,
  stageNoticeCheckDue,
  stageOnScreenMetadata,
  stageOnScreenOfMetadata,
  stageStateOf,
  stageVideoApiUrl,
  stageVideoConfig,
  stageVideoRoom,
  stageVideoSocketUrl,
  stageViewerIdentity,
  stageViewerMember,
  type StageIngress,
  type StageVideoApi,
} from "@/lib/chatStageVideo";
import { STAGE_VIEWER_TOKEN_TTL_SECONDS, stageVideoApi, stageViewerGrant } from "@/lib/chatStageLiveKit";
import { STAGE_PHONE_QUERY, newerStageOnScreen, parseStageOnScreen, parseStageState, parseStageTicker, stageLiveBadge, stagePhoneReachable, stageReachable } from "@/lib/chatStageLive";
import { stageModeAllowed } from "@/lib/chatStageMode";
import { ablyRoomEventActions } from "@/lib/chatRealtimeChannels";

const ENV = { LIVEKIT_URL: "wss://fake.livekit.test", LIVEKIT_API_KEY: "APIfakekey", LIVEKIT_API_SECRET: "fake-secret-never-real-0123456789abcdef" };

function fakeApi(initial: StageIngress[] = []) {
  const state = { ingresses: [...initial], made: 0, metadata: new Map<string, string>() };
  const api: StageVideoApi & { state: typeof state; calls: string[] } = {
    state,
    calls: [],
    ingresses: async (room) => {
      api.calls.push(`list:${room}`);
      return state.ingresses.map((ingress) => ({ ...ingress }));
    },
    createIngress: async (room) => {
      api.calls.push(`create:${room}`);
      const ingress = { id: `IN_${++state.made}`, url: "rtmps://fake.livekit.test/x", streamKey: `FAKE-KEY-${state.made}`, publishing: false };
      state.ingresses.push(ingress);
      return ingress;
    },
    deleteIngress: async (id) => {
      api.calls.push(`delete:${id}`);
      state.ingresses = state.ingresses.filter((ingress) => ingress.id !== id);
    },
    roomMetadata: async (room) => {
      api.calls.push(`metadata:${room}`);
      return state.metadata.get(room) ?? null;
    },
    setRoomMetadata: async (room, metadata) => {
      api.calls.push(`setMetadata:${room}`);
      state.metadata.set(room, metadata);
    },
    viewerToken: async () => "unused",
  };
  return api;
}

describe("settings", () => {
  it("is on only with all three LiveKit settings", () => {
    expect(stageVideoConfig(ENV)).toEqual({ url: ENV.LIVEKIT_URL, apiKey: ENV.LIVEKIT_API_KEY, apiSecret: ENV.LIVEKIT_API_SECRET });
    for (const missing of Object.keys(ENV)) expect(stageVideoConfig({ ...ENV, [missing]: undefined })).toBeNull();
    for (const missing of Object.keys(ENV)) expect(stageVideoConfig({ ...ENV, [missing]: "  " })).toBeNull();
    expect(stageVideoConfig({})).toBeNull();
    expect(stageVideoConfig({ ...ENV, LIVEKIT_URL: "not a url" })).toBeNull();
  });
  it("CHAT_STAGE_MODE=off turns live video off as well", () => {
    expect(stageVideoConfig({ ...ENV, CHAT_STAGE_MODE: "off" })).toBeNull();
    expect(stageVideoConfig({ ...ENV, CHAT_STAGE_MODE: " OFF " })).toBeNull();
    expect(stageVideoConfig({ ...ENV, CHAT_STAGE_MODE: "on" })).not.toBeNull();
  });
  it("gives browsers the socket address and the server the API address", () => {
    const config = stageVideoConfig(ENV)!;
    expect(stageVideoSocketUrl(config)).toBe("wss://fake.livekit.test");
    expect(stageVideoApiUrl(config)).toBe("https://fake.livekit.test");
    const plain = stageVideoConfig({ ...ENV, LIVEKIT_URL: "https://fake.livekit.test" })!;
    expect(stageVideoSocketUrl(plain)).toBe("wss://fake.livekit.test");
    expect(stageVideoApiUrl(plain)).toBe("https://fake.livekit.test");
  });
});

describe("names", () => {
  it("names the LiveKit room from the chat room, and back", () => {
    expect(stageVideoRoom("main")).toBe("chat-main");
    expect(stageVideoRoom("lb-review")).toBe("chat-lb-review");
    expect(chatRoomOfStageVideoRoom("chat-main")).toBe("main");
    expect(chatRoomOfStageVideoRoom("chat-lb-review")).toBe("lb-review");
    for (const other of ["main", "chat-", "chat-nowhere", "", null, 7]) expect(chatRoomOfStageVideoRoom(other)).toBeNull();
  });
  it("gives each connection its own identity and still knows the member", () => {
    const identity = stageViewerIdentity("member-1", "ab12cd34");
    expect(identity).not.toBe(stageViewerIdentity("member-1", "ffffffff"));
    expect(stageViewerMember(identity)).toBe("member-1");
    expect(stageViewerMember("stage-broadcast")).toBe("stage-broadcast");
  });
});

describe("the room's state", () => {
  it("is off without an ingress, waiting with one, live while it publishes", () => {
    expect(stageStateOf([])).toBe("off");
    expect(stageStateOf([{ publishing: false }])).toBe("waiting");
    expect(stageStateOf([{ publishing: false }, { publishing: true }])).toBe("live");
    expect(parseStageState("live")).toBe("live");
    expect(parseStageState("waiting")).toBe("waiting");
    for (const other of ["off", "LIVE", "", null, undefined, 1]) expect(parseStageState(other)).toBe("off");
  });
  it("asks only for that room's LiveKit room", async () => {
    const api = fakeApi([{ id: "IN_1", url: "u", streamKey: "k", publishing: true }]);
    expect(await readStageState(api, "main")).toBe("live");
    expect(api.calls).toEqual(["list:chat-main"]);
  });
});

describe("the shared memory of a room's state", () => {
  beforeEach(() => forgetStageState());
  it("asks LiveKit once per window however many ask", async () => {
    const read = vi.fn(async () => "live" as "live" | "off");
    expect(await sharedStageState("main", read, 1_000)).toBe("live");
    expect(await sharedStageState("main", read, 1_000 + STAGE_STATE_MEMORY_MS - 1)).toBe("live");
    expect(read).toHaveBeenCalledTimes(1);
    read.mockResolvedValue("off");
    expect(await sharedStageState("main", read, 1_000 + STAGE_STATE_MEMORY_MS)).toBe("off");
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("shares one read between requests that arrive together", async () => {
    let finish!: (state: "waiting") => void;
    const read = vi.fn(() => new Promise<"waiting">((resolve) => (finish = resolve)));
    const both = Promise.all([sharedStageState("main", read, 5_000), sharedStageState("main", read, 5_001), sharedStageState("main", read, 5_002)]);
    finish("waiting");
    expect(await both).toEqual(["waiting", "waiting", "waiting"]);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("keeps rooms apart", async () => {
    const main = vi.fn(async () => "live" as const);
    const social = vi.fn(async () => "off" as const);
    expect(await sharedStageState("main", main, 1)).toBe("live");
    expect(await sharedStageState("social", social, 1)).toBe("off");
    expect(await sharedStageState("main", social, 2)).toBe("live");
    expect(main).toHaveBeenCalledTimes(1);
    expect(social).toHaveBeenCalledTimes(1);
  });
  it("remembers a failed read as off for the window, so an outage is not hammered", async () => {
    const read = vi.fn(async (): Promise<"live"> => {
      throw new Error("LiveKit is down");
    });
    expect(await sharedStageState("main", read, 10)).toBe("off");
    expect(await sharedStageState("main", read, 11)).toBe("off");
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("forgets a room after its key is made or reset", async () => {
    const read = vi.fn(async () => "off" as "off" | "waiting");
    await sharedStageState("main", read, 100);
    forgetStageState("main");
    read.mockResolvedValue("waiting");
    expect(await sharedStageState("main", read, 101)).toBe("waiting");
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("does not let a read that began before a change overwrite what came after", async () => {
    let finish!: (state: "off") => void;
    const slow = sharedStageState("main", () => new Promise<"off">((resolve) => (finish = resolve)), 200);
    forgetStageState("main");
    finish("off");
    await slow;
    const read = vi.fn(async () => "waiting" as const);
    expect(await sharedStageState("main", read, 201)).toBe("waiting");
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe("#512: one permanent stream address and key per room", () => {
  const existing = (over: Partial<StageIngress> = {}): StageIngress => ({ id: "IN_old", url: "rtmps://fake.livekit.test/x", streamKey: "FAKE-KEY-ALREADY-IN-STREAMYARD", publishing: false, ...over });
  it("makes the room's ingress the first time and gives the same one back ever after", async () => {
    const api = fakeApi();
    expect(await readStageKey(api, "main")).toBeNull();
    const first = await stageKeyFor(api, "main");
    expect(first).toMatchObject({ created: true, extra: 0, ingress: { id: "IN_1", streamKey: "FAKE-KEY-1" } });
    for (let i = 0; i < 5; i++) expect(await stageKeyFor(api, "main")).toMatchObject({ created: false, extra: 0, ingress: { id: "IN_1", streamKey: "FAKE-KEY-1" } });
    expect(await readStageKey(api, "main")).toMatchObject({ created: false, ingress: { streamKey: "FAKE-KEY-1" } });
    expect(api.calls.filter((call) => call.startsWith("create"))).toEqual(["create:chat-main"]);
    expect(api.calls.some((call) => call.startsWith("delete"))).toBe(false);
  });
  it("reuses an ingress the room already has (a key already pasted into StreamYard), broadcasting or not, and never makes or deletes one", async () => {
    for (const publishing of [false, true]) {
      const api = fakeApi([existing({ publishing })]);
      expect(await stageKeyFor(api, "main")).toEqual({ ingress: existing({ publishing }), created: false, extra: 0 });
      expect(await stageKeyFor(api, "main")).toMatchObject({ ingress: { streamKey: "FAKE-KEY-ALREADY-IN-STREAMYARD" } });
      expect(api.calls).toEqual(["list:chat-main", "list:chat-main"]);
      expect(api.state.ingresses).toEqual([existing({ publishing })]);
    }
  });
  it("two requests at once for a room with none make one ingress", async () => {
    const api = fakeApi();
    const [a, b] = await Promise.all([stageKeyFor(api, "main"), stageKeyFor(api, "main")]);
    expect(a.ingress.streamKey).toBe(b.ingress.streamKey);
    expect(api.state.ingresses).toHaveLength(1);
    // A failed attempt is not remembered: the next one tries again.
    const down = fakeApi();
    const create = down.createIngress;
    down.createIngress = async () => {
      throw new Error("LiveKit is down");
    };
    await expect(stageKeyFor(down, "social")).rejects.toThrow();
    down.createIngress = create;
    expect((await stageKeyFor(down, "social")).created).toBe(true);
  });
  it("with more than one ingress: the one broadcasting, else the most recently used, else LiveKit's first; the others are counted and left alone", async () => {
    const a = existing({ id: "IN_a", streamKey: "KEY-a" });
    const b = existing({ id: "IN_b", streamKey: "KEY-b" });
    const c = existing({ id: "IN_c", streamKey: "KEY-c" });
    expect(stageIngressOf([])).toBeUndefined();
    expect(stageIngressOf([a, b, c])?.id).toBe("IN_a");
    expect(stageIngressOf([a, { ...b, activeAt: 2_000 }, { ...c, activeAt: 1_000 }])?.id).toBe("IN_b");
    expect(stageIngressOf([{ ...a, activeAt: 9_000 }, b, { ...c, publishing: true, activeAt: 1 }])?.id).toBe("IN_c");
    expect(stageIngressOf([{ ...a, activeAt: 5 }, { ...b, activeAt: 5 }])?.id).toBe("IN_a");
    const api = fakeApi([a, { ...b, activeAt: 2_000 }, c]);
    expect(await stageKeyFor(api, "main")).toMatchObject({ created: false, extra: 2, ingress: { id: "IN_b", streamKey: "KEY-b" } });
    expect(await readStageKey(api, "main")).toMatchObject({ extra: 2, ingress: { id: "IN_b" } });
    expect(api.calls).toEqual(["list:chat-main", "list:chat-main"]);
    expect(api.state.ingresses).toHaveLength(3);
  });
  it("reset deletes the room's ingress and makes a new one with a different key; the LiveKit room is not touched", async () => {
    const api = fakeApi([existing({ publishing: true })]);
    const reset = await resetStageKey(api, "main");
    expect(reset).toMatchObject({ created: true, extra: 0, ingress: { id: "IN_1", streamKey: "FAKE-KEY-1", publishing: false } });
    expect(api.calls).toEqual(["list:chat-main", "delete:IN_old", "create:chat-main"]);
    expect(api.state.ingresses.map((ingress) => ingress.streamKey)).toEqual(["FAKE-KEY-1"]);
    // The new key is now the room's permanent one.
    expect(await stageKeyFor(api, "main")).toMatchObject({ created: false, ingress: { streamKey: "FAKE-KEY-1" } });
    expect(await readStageState(api, "main")).toBe("waiting");
    // Reset is the one thing that clears out strays too.
    const many = fakeApi([existing({ id: "IN_a" }), existing({ id: "IN_b" })]);
    await resetStageKey(many, "main");
    expect(many.calls).toEqual(["list:chat-main", "delete:IN_a", "delete:IN_b", "create:chat-main"]);
    expect(many.state.ingresses).toHaveLength(1);
  });
  it("a set-up room rests at waiting, is live only while publishing, and is never off again", async () => {
    const api = fakeApi();
    expect(await readStageState(api, "main")).toBe("off");
    await stageKeyFor(api, "main");
    expect(await readStageState(api, "main")).toBe("waiting");
    api.state.ingresses[0].publishing = true;
    expect(await readStageState(api, "main")).toBe("live");
    api.state.ingresses[0].publishing = false;
    expect(await readStageState(api, "main")).toBe("waiting");
  });
});

describe("#512: the status noticing a change nobody signalled", () => {
  it("asks for the room's message to be checked when this server sees the state change, and otherwise once a minute", () => {
    // A room that was never set up has no message to keep right.
    expect(stageNoticeCheckDue("main", "off", 1_000)).toBe(false);
    expect(stageNoticeCheckDue("main", "off", 1_000 + STAGE_NOTICE_CHECK_MS)).toBe(false);
    expect(stageNoticeCheckDue("main", "waiting", 2_000_000)).toBe(true);
    expect(stageNoticeCheckDue("main", "waiting", 2_000_001)).toBe(false);
    // The broadcast arrives, and stops, with no webhook: each is seen at the next fresh read.
    expect(stageNoticeCheckDue("main", "live", 2_000_002)).toBe(true);
    expect(stageNoticeCheckDue("main", "live", 2_004_000)).toBe(false);
    expect(stageNoticeCheckDue("main", "waiting", 2_008_000)).toBe(true);
    expect(stageNoticeCheckDue("main", "waiting", 2_008_000 + STAGE_NOTICE_CHECK_MS - 1)).toBe(false);
    // Nothing changed for a minute: looked at once more (another server may have seen it live).
    expect(stageNoticeCheckDue("main", "waiting", 2_008_000 + STAGE_NOTICE_CHECK_MS)).toBe(true);
    // Its ingress deleted by hand at LiveKit: checked that once.
    expect(stageNoticeCheckDue("main", "off", 3_000_000)).toBe(true);
    expect(stageNoticeCheckDue("main", "off", 3_000_000 + STAGE_NOTICE_CHECK_MS)).toBe(false);
    // Per room, and forgotten only with everything (a signal for one room does not reset its minute).
    expect(stageNoticeCheckDue("social", "live", 3_000_000)).toBe(true);
    forgetStageState("social");
    expect(stageNoticeCheckDue("social", "live", 3_000_001)).toBe(false);
    forgetStageState();
    expect(stageNoticeCheckDue("social", "live", 3_000_002)).toBe(true);
  });
});

describe("who may open the stage", () => {
  it("admins at any time; members only while the room is live and video is set up", () => {
    for (const state of ["off", "waiting", "live"] as const) {
      expect(stageReachable({ admin: true, video: true }, state)).toBe(true);
      expect(stageReachable({ admin: true, video: false }, state)).toBe(true);
      expect(stageReachable({ admin: false, video: false }, state)).toBe(false);
    }
    expect(stageReachable({ admin: false, video: true }, "live")).toBe(true);
    expect(stageReachable({ admin: false, video: true }, "waiting")).toBe(false);
    expect(stageReachable({ admin: false, video: true }, "off")).toBe(false);
  });
  it("#509 a phone's viewing room: members while live, admins once started, nobody without video or before a start", () => {
    for (const admin of [true, false]) {
      expect(stagePhoneReachable({ admin, video: true }, "live")).toBe(true);
      expect(stagePhoneReachable({ admin, video: true }, "off")).toBe(false);
      for (const state of ["off", "waiting", "live"] as const) expect(stagePhoneReachable({ admin, video: false }, state)).toBe(false);
    }
    expect(stagePhoneReachable({ admin: true, video: true }, "waiting")).toBe(true);
    expect(stagePhoneReachable({ admin: false, video: true }, "waiting")).toBe(false);
  });
  it("#509 a phone is a touch screen, upright or on its side", () => {
    expect(STAGE_PHONE_QUERY.split(", ")).toEqual([
      "(pointer: coarse) and (max-width: 40rem)",
      "(pointer: coarse) and (orientation: landscape) and (max-height: 31.25rem)",
    ]);
  });
  it("shows the LIVE button only while live, and never without video", () => {
    expect(stageLiveBadge(true, "live")).toBe(true);
    expect(stageLiveBadge(true, "waiting")).toBe(false);
    expect(stageLiveBadge(true, "off")).toBe(false);
    expect(stageLiveBadge(false, "live")).toBe(false);
  });
  it("the admin gate is unchanged", () => {
    expect(stageModeAllowed(true, undefined)).toBe(true);
    expect(stageModeAllowed(false, undefined)).toBe(false);
    expect(stageModeAllowed(true, "off")).toBe(false);
  });
});

describe("the viewer token", () => {
  const claims = (jwt: string) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
  it("can subscribe and nothing else", () => {
    expect(stageViewerGrant("chat-main")).toEqual({
      room: "chat-main",
      roomJoin: true,
      canSubscribe: true,
      canPublish: false,
      canPublishData: false,
      canUpdateOwnMetadata: false,
    });
  });
  it("is signed for one room, one viewer, and a short time", async () => {
    const api = stageVideoApi(stageVideoConfig(ENV)!);
    const before = Math.floor(Date.now() / 1000);
    const jwt = await api.viewerToken("chat-main", "member-1#ab12cd34", "Bob Test");
    const payload = claims(jwt);
    expect(payload.sub).toBe("member-1#ab12cd34");
    expect(payload.name).toBe("Bob Test");
    expect(payload.iss).toBe(ENV.LIVEKIT_API_KEY);
    expect(payload.video).toEqual(stageViewerGrant("chat-main"));
    for (const grant of ["roomAdmin", "roomCreate", "roomList", "roomRecord", "ingressAdmin", "canPublishSources", "hidden", "recorder"])
      expect(payload.video[grant]).toBeUndefined();
    expect(payload.exp - before).toBeGreaterThanOrEqual(STAGE_VIEWER_TOKEN_TTL_SECONDS - 5);
    expect(payload.exp - before).toBeLessThanOrEqual(STAGE_VIEWER_TOKEN_TTL_SECONDS + 5);
    expect(jwt).not.toContain(ENV.LIVEKIT_API_SECRET);
  });
});

describe("#507: the stock on screen", () => {
  const started: StageIngress[] = [{ id: "IN_1", url: "rtmps://fake.livekit.test/x", streamKey: "FAKE-KEY", publishing: false }];
  beforeEach(() => forgetStageState());
  it("reads a ticker as the host types it", () => {
    for (const [typed, ticker] of [["apus", "APUS"], [" Aehl ", "AEHL"], ["BRK.B", "BRK.B"], ["brk-b", "BRK.B"], ["F", "F"], ["GOOGL", "GOOGL"], ["bf.aa", "BF.AA"]])
      expect(parseStageTicker(typed)).toBe(ticker);
    for (const bad of ["", " ", "TOOLONG", "AB1", "$APUS", "A B", "BRK.", ".B", "BRK.BBB", "BRK..B", "BRK-B-C", "A/B", "<b>", "APUS;drop", null, undefined, 7, {}])
      expect(parseStageTicker(bad)).toBeNull();
  });
  it("reads what is on screen strictly: a clean ticker (or null) and a time", () => {
    expect(parseStageOnScreen({ symbol: "APUS", at: 5 })).toEqual({ symbol: "APUS", at: 5 });
    expect(parseStageOnScreen({ symbol: null, at: 5 })).toEqual({ symbol: null, at: 5 });
    for (const bad of [null, "APUS", {}, { symbol: "APUS" }, { symbol: "apus", at: 5 }, { symbol: "APUS", at: 0 }, { symbol: "APUS", at: "5" }, { symbol: "<script>", at: 5 }, { symbol: 7, at: 5 }])
      expect(parseStageOnScreen(bad)).toBeNull();
  });
  it("keeps the newest it has heard of", () => {
    const older = { symbol: "AAA", at: 10 }, newer = { symbol: "BBB", at: 20 };
    expect(newerStageOnScreen(null, older)).toBe(older);
    expect(newerStageOnScreen(older, newer)).toBe(newer);
    expect(newerStageOnScreen(newer, older)).toBe(newer);
    expect(newerStageOnScreen(newer, null)).toBe(newer);
    // A clear is a change like any other.
    expect(newerStageOnScreen(newer, { symbol: null, at: 30 })).toEqual({ symbol: null, at: 30 });
  });
  it("is kept as small JSON in the LiveKit room's metadata, and read back from it", () => {
    expect(stageOnScreenMetadata({ symbol: "APUS", at: 1_700_000_000_000 })).toBe('{"onScreen":"APUS","at":1700000000000}');
    expect(stageOnScreenOfMetadata('{"onScreen":"APUS","at":1700000000000}')).toEqual({ symbol: "APUS", at: 1_700_000_000_000 });
    expect(stageOnScreenOfMetadata('{"onScreen":null,"at":9}')).toEqual({ symbol: null, at: 9 });
    for (const other of [null, undefined, "", "not json", "[]", '"APUS"', '{"at":9}', '{"onScreen":"apus!","at":9}', '{"onScreen":"APUS"}'])
      expect(stageOnScreenOfMetadata(other)).toBeNull();
  });
  it("is set and cleared in the room chat-<slug>, only for a room that has its stream key (broadcasting or not)", async () => {
    const api = fakeApi(started);
    expect(await setStageOnScreen(api, "main", "APUS", 111)).toEqual({ symbol: "APUS", at: 111 });
    expect(api.calls).toEqual(["list:chat-main", "setMetadata:chat-main"]);
    expect(api.state.metadata.get("chat-main")).toBe('{"onScreen":"APUS","at":111}');
    expect(await readStageOnScreen(api, "main")).toEqual({ symbol: "APUS", at: 111 });
    expect(await readStageOnScreen(api, "social")).toBeNull();
    expect(await setStageOnScreen(api, "main", null, 222)).toEqual({ symbol: null, at: 222 });
    expect(await readStageOnScreen(api, "main")).toEqual({ symbol: null, at: 222 });
    const off = fakeApi();
    expect(await setStageOnScreen(off, "main", "APUS", 333)).toBeNull();
    expect(off.calls).toEqual(["list:chat-main"]);
    expect(off.state.metadata.size).toBe(0);
  });
  it("is remembered per room for a few seconds, and forgotten with the state", async () => {
    const read = vi.fn().mockResolvedValueOnce({ symbol: "APUS", at: 1 }).mockResolvedValueOnce({ symbol: "NEWT", at: 2 });
    expect(await sharedStageOnScreen("main", read, 1_000)).toEqual({ symbol: "APUS", at: 1 });
    expect(await sharedStageOnScreen("main", read, 1_000 + STAGE_STATE_MEMORY_MS - 1)).toEqual({ symbol: "APUS", at: 1 });
    expect(read).toHaveBeenCalledTimes(1);
    forgetStageState("main");
    expect(await sharedStageOnScreen("main", read, 1_001)).toEqual({ symbol: "NEWT", at: 2 });
    // A failed read: nothing known, and LiveKit is not asked again inside the window.
    forgetStageState();
    const down = vi.fn().mockRejectedValue(new Error("down"));
    expect(await sharedStageOnScreen("main", down, 10)).toBeNull();
    expect(await sharedStageOnScreen("main", down, 11)).toBeNull();
    expect(down).toHaveBeenCalledTimes(1);
  });
});

describe("the realtime signal", () => {
  const stage = { kind: "changed", topics: ["stage"] };
  it("asks the room on screen for its status again, and reloads nothing", () => {
    expect(ablyRoomEventActions("main", ["main"], "changed", stage)).toEqual({ detail: null, topics: [], stage: { room: "main" } });
  });
  it("#507: carries the stock the host put on screen, and drops anything that is not one", () => {
    const set = { ...stage, onScreen: { symbol: "APUS", at: 5 } };
    expect(ablyRoomEventActions("main", ["main"], "changed", set)).toEqual({ detail: null, topics: [], stage: { room: "main", onScreen: { symbol: "APUS", at: 5 } } });
    expect(ablyRoomEventActions("main", ["main"], "changed", { ...stage, onScreen: { symbol: null, at: 6 } })).toEqual({ detail: null, topics: [], stage: { room: "main", onScreen: { symbol: null, at: 6 } } });
    expect(ablyRoomEventActions("main", ["main"], "changed", { ...stage, onScreen: { symbol: "<img>", at: 5 } })).toEqual({ detail: null, topics: [], stage: { room: "main" } });
    expect(ablyRoomEventActions("social", ["main"], "changed", set)).toEqual({ detail: null, topics: [] });
  });
  it("does nothing for a room that is not on screen", () => {
    expect(ablyRoomEventActions("social", ["main"], "changed", stage)).toEqual({ detail: null, topics: [] });
  });
});
