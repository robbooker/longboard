// #502 Stage mode's live video: settings, names, the "is it live" memory, start/end, who may open
// the stage, the viewer token's grants and the realtime signal. No LiveKit is reached: the token is
// signed locally with made-up keys and everything else runs against a fake StageVideoApi.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  STAGE_STATE_MEMORY_MS,
  chatRoomOfStageVideoRoom,
  endStageVideo,
  forgetStageState,
  readStageState,
  sharedStageState,
  startStageVideo,
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
import { parseStageState, stageLiveBadge, stageReachable } from "@/lib/chatStageLive";
import { stageModeAllowed } from "@/lib/chatStageMode";
import { ablyRoomEventActions } from "@/lib/chatRealtimeChannels";

const ENV = { LIVEKIT_URL: "wss://fake.livekit.test", LIVEKIT_API_KEY: "APIfakekey", LIVEKIT_API_SECRET: "fake-secret-never-real-0123456789abcdef" };

function fakeApi(initial: StageIngress[] = []) {
  const state = { ingresses: [...initial], made: 0 };
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
    deleteRoom: async (room) => {
      api.calls.push(`deleteRoom:${room}`);
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
  it("forgets a room after a start or an end", async () => {
    const read = vi.fn(async () => "off" as "off" | "waiting");
    await sharedStageState("main", read, 100);
    forgetStageState("main");
    read.mockResolvedValue("waiting");
    expect(await sharedStageState("main", read, 101)).toBe("waiting");
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("does not let a read that began before a start overwrite what came after", async () => {
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

describe("start and end", () => {
  it("creates the ingress once and reuses it after that", async () => {
    const api = fakeApi();
    const first = await startStageVideo(api, "main");
    expect(first).toMatchObject({ id: "IN_1", streamKey: "FAKE-KEY-1" });
    const again = await startStageVideo(api, "main");
    expect(again).toMatchObject({ id: "IN_1", streamKey: "FAKE-KEY-1" });
    expect(api.calls).toEqual(["list:chat-main", "create:chat-main", "list:chat-main"]);
  });
  it("ends by deleting every ingress of the room, then the LiveKit room", async () => {
    const api = fakeApi([
      { id: "IN_a", url: "u", streamKey: "k", publishing: true },
      { id: "IN_b", url: "u", streamKey: "k", publishing: false },
    ]);
    await endStageVideo(api, "main");
    expect(api.calls).toEqual(["list:chat-main", "delete:IN_a", "delete:IN_b", "deleteRoom:chat-main"]);
    expect(await readStageState(api, "main")).toBe("off");
  });
  it("ending a room nobody joined is not a failure", async () => {
    const api = fakeApi([{ id: "IN_a", url: "u", streamKey: "k", publishing: false }]);
    api.deleteRoom = async () => {
      throw new Error("room not found");
    };
    await expect(endStageVideo(api, "main")).resolves.toBeUndefined();
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

describe("the realtime signal", () => {
  const stage = { kind: "changed", topics: ["stage"] };
  it("asks the room on screen for its status again, and reloads nothing", () => {
    expect(ablyRoomEventActions("main", ["main"], "changed", stage)).toEqual({ detail: null, topics: [], stage: { room: "main" } });
  });
  it("does nothing for a room that is not on screen", () => {
    expect(ablyRoomEventActions("social", ["main"], "changed", stage)).toEqual({ detail: null, topics: [] });
  });
});
