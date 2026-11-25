// #507: the real StageVideoApi's two room-metadata calls, against a fake LiveKit client (no LiveKit
// is reached): the read asks for the one room by name, and the write makes the room when LiveKit
// has none yet.
import { beforeEach, describe, expect, it, vi } from "vitest";

const lk = vi.hoisted(() => ({ rooms: new Map<string, string>(), calls: [] as string[], made: [] as unknown[] }));
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
  },
}));
import { stageVideoApi } from "@/lib/chatStageLiveKit";
import { readStageOnScreen, stageOnScreenMetadata } from "@/lib/chatStageVideo";

const api = () => stageVideoApi({ url: "wss://fake.livekit.test", apiKey: "APIfakekey", apiSecret: "fake-secret-never-real-0123456789abcdef" });
beforeEach(() => {
  lk.rooms = new Map();
  lk.calls = [];
  lk.made = [];
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
