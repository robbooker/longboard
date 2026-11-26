// #507: the real StageVideoApi's two room-metadata calls, against a fake LiveKit client (no LiveKit
// is reached): the read asks for the one room by name, and the write makes the room when LiveKit
// has none yet.
import { beforeEach, describe, expect, it, vi } from "vitest";

const lk = vi.hoisted(() => ({
  rooms: new Map<string, string>(),
  calls: [] as string[],
  made: [] as unknown[],
  people: new Map<string, { joinedAt: bigint; joinedAtMs: bigint; attributes: Record<string, string> }>(),
  removed: [] as unknown[],
  down: false,
}));
const twirp = (code: string, status: number) => Object.assign(new Error(code), { code, status });
vi.mock("livekit-server-sdk", async (original) => ({
  ...(await original<typeof import("livekit-server-sdk")>()),
  RoomServiceClient: class {
    constructor(public host: string) {
      lk.calls.push(`client:${host}`);
    }
    async listRooms(names?: string[]) {
      lk.calls.push(`listRooms:${names?.join(",")}`);
      // A stand-in that, like a careless server, answers with every room it has.
      return [...lk.rooms].map(([name, metadata]) => ({ name, metadata }));
    }
    async updateRoomMetadata(room: string, metadata: string) {
      lk.calls.push(`update:${room}`);
      if (!lk.rooms.has(room)) throw new Error("requested room does not exist");
      lk.rooms.set(room, metadata);
    }
    async createRoom(options: { name: string; metadata?: string }) {
      lk.calls.push(`create:${options.name}`);
      lk.made.push(options);
      lk.rooms.set(options.name, options.metadata ?? "");
    }
    async getParticipant(room: string, identity: string) {
      lk.calls.push(`get:${room}:${identity}`);
      if (lk.down) throw twirp("unavailable", 503);
      const person = lk.people.get(`${room}|${identity}`);
      if (!person) throw twirp("not_found", 404);
      return { identity, ...person };
    }
    async removeParticipant(room: string, identity: string, options?: unknown) {
      lk.calls.push(`remove:${room}:${identity}`);
      lk.removed.push(options);
      if (lk.down) throw twirp("unavailable", 503);
      if (!lk.people.delete(`${room}|${identity}`)) throw twirp("not_found", 404);
    }
    async deleteRoom(room: string) {
      lk.calls.push(`delete:${room}`);
      if (lk.down) throw twirp("unavailable", 503);
      if (!lk.rooms.delete(room)) throw twirp("not_found", 404);
    }
  },
}));
import { STAGE_VIEWER_TOKEN_TTL_SECONDS, stageVideoApi, stageViewerGrant } from "@/lib/chatStageLiveKit";
import { readStageOnScreen, stageOnScreenMetadata } from "@/lib/chatStageVideo";

const api = () => stageVideoApi({ url: "wss://fake.livekit.test", apiKey: "APIfakekey", apiSecret: "fake-secret-never-real-0123456789abcdef" });
beforeEach(() => {
  lk.rooms = new Map();
  lk.calls = [];
  lk.made = [];
  lk.people = new Map();
  lk.removed = [];
  lk.down = false;
});

describe("LiveKit room metadata (#507)", () => {
  it("reads the named room's metadata over https, and null when there is no such room", async () => {
    lk.rooms.set("chat-social", "other");
    expect(await api().roomMetadata("chat-main")).toBeNull();
    lk.rooms.set("chat-main", '{"onScreen":"APUS","at":5}');
    expect(await api().roomMetadata("chat-main")).toBe('{"onScreen":"APUS","at":5}');
    expect(lk.calls).toContain("client:https://fake.livekit.test");
    expect(lk.calls.filter((call) => call.startsWith("listRooms"))).toEqual(["listRooms:chat-main", "listRooms:chat-main"]);
    expect(await readStageOnScreen(api(), "main")).toEqual({ symbol: "APUS", at: 5 });
  });
  it("updates a room that exists, without making one", async () => {
    lk.rooms.set("chat-main", "");
    await api().setRoomMetadata("chat-main", stageOnScreenMetadata({ symbol: "NEWT", at: 9 }));
    expect(lk.rooms.get("chat-main")).toBe('{"onScreen":"NEWT","at":9}');
    expect(lk.calls.filter((call) => !call.startsWith("client"))).toEqual(["update:chat-main"]);
  });
  it("makes the room, carrying the metadata, when nobody has joined it yet", async () => {
    await api().setRoomMetadata("chat-main", '{"onScreen":"NEWT","at":9}');
    expect(lk.calls.filter((call) => !call.startsWith("client"))).toEqual(["update:chat-main", "create:chat-main"]);
    expect(lk.made).toEqual([{ name: "chat-main", metadata: '{"onScreen":"NEWT","at":9}' }]);
    expect(await api().roomMetadata("chat-main")).toBe('{"onScreen":"NEWT","at":9}');
  });
});

// #522: the calls behind the seat limit, removing a viewer and closing a room.
describe("LiveKit viewers and rooms (#522)", () => {
  const claims = (jwt: string) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
  it("says who holds a seat (when they joined, and which tab), and null when nobody does", async () => {
    lk.people.set("chat-main|m1#00000001", { joinedAt: BigInt(1_700_000_000), joinedAtMs: BigInt(1_700_000_000_123), attributes: { tab: "taba123456", hand: "5" } });
    lk.people.set("chat-main|m1#00000002", { joinedAt: BigInt(1_700_000_050), joinedAtMs: BigInt(0), attributes: {} });
    expect(await api().viewer("chat-main", "m1#00000001")).toEqual({ joinedAt: 1_700_000_000_123, tab: "taba123456" });
    // An older LiveKit that reports seconds only.
    expect(await api().viewer("chat-main", "m1#00000002")).toEqual({ joinedAt: 1_700_000_050_000 });
    expect(await api().viewer("chat-main", "m2#00000001")).toBeNull();
    expect(await api().viewer("chat-social", "m1#00000001")).toBeNull();
    lk.down = true;
    await expect(api().viewer("chat-main", "m1#00000001")).rejects.toThrow();
  });
  it("removes a viewer (false when they were not there), revoking the tokens they hold when asked", async () => {
    lk.people.set("chat-main|m1#00000001", { joinedAt: BigInt(1), joinedAtMs: BigInt(1_000), attributes: {} });
    const before = BigInt(Math.floor(Date.now() / 1000));
    expect(await api().removeViewer("chat-main", "m1#00000001", true)).toBe(true);
    expect(await api().removeViewer("chat-main", "m1#00000001", true)).toBe(false);
    expect(await api().removeViewer("chat-main", "m1#00000002")).toBe(false);
    const [revoked, again, plain] = lk.removed as ({ revokeTokenTs?: bigint } | undefined)[];
    expect(revoked?.revokeTokenTs).toBeGreaterThanOrEqual(before);
    expect(again?.revokeTokenTs).toBeGreaterThanOrEqual(before);
    expect(plain).toBeUndefined();
    lk.down = true;
    await expect(api().removeViewer("chat-main", "m1#00000001")).rejects.toThrow();
  });
  it("closes a room, and a room that is already gone is not an error", async () => {
    lk.rooms.set("chat-main", '{"onScreen":"APUS","at":5}');
    await api().closeRoom("chat-main");
    expect(lk.rooms.has("chat-main")).toBe(false);
    await expect(api().closeRoom("chat-main")).resolves.toBeUndefined();
    lk.down = true;
    await expect(api().closeRoom("chat-main")).rejects.toThrow();
  });
  it("lists the rooms that exist", async () => {
    lk.rooms.set("chat-main", "");
    lk.rooms.set("another-app", "");
    expect(await api().videoRooms()).toEqual(["chat-main", "another-app"]);
  });
  it("a viewer token lasts one minute and carries the tab's name; without one it carries nothing extra", async () => {
    expect(STAGE_VIEWER_TOKEN_TTL_SECONDS).toBe(60);
    const before = Math.floor(Date.now() / 1000);
    const named = claims(await api().viewerToken("chat-main", "m1#00000002", "Bob Test", "taba123456"));
    expect(named.sub).toBe("m1#00000002");
    expect(named.attributes).toEqual({ tab: "taba123456" });
    expect(named.exp - before).toBeGreaterThanOrEqual(59);
    expect(named.exp - before).toBeLessThanOrEqual(62);
    expect(named.video).toEqual(stageViewerGrant("chat-main"));
    expect(claims(await api().viewerToken("chat-main", "m1#00000001", "Bob Test")).attributes).toBeUndefined();
  });
});
