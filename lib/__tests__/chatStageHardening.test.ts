// #522 / #523: the stage's stricter rules, as plain values (no LiveKit, no browser, no database):
//  - a stage request names its room as text, in a JSON object, and says where it came from;
//  - a member's connections to a video room are two seats, chosen without any shared memory;
//  - a webhook with no id is never acted on; a state is acted on once however often it is reported;
//  - "waiting" is remembered for half a minute, but never for a read that a signal caused;
//  - after a broadcast ends the LiveKit room is closed, once; a member who loses access is removed;
//  - a player retries by itself at most once, and never in a way that can loop.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { STAGE_HEALTHY_MS, STAGE_LINK_IDLE, STAGE_SEAT_RACE_MS, stageAutoRetry, stageLinkStep, type StageLinkInput } from "@/lib/chatStageLink";
import { stageBody, stageOriginAllowed } from "@/lib/chatStageRequest";
import {
  STAGE_SETTLED_MEMORY_MS,
  STAGE_STATE_MEMORY_MS,
  STAGE_VIEWER_SEATS,
  forgetStageState,
  forgetStageWebhooks,
  parseStageRoom,
  parseStageTab,
  pickStageSeat,
  sharedStageOnScreen,
  sharedStageState,
  stageSeatFor,
  stageStateNews,
  stageStopSeen,
  stageViewerIdentities,
  stageViewerIdentity,
  stageWebhookIsNew,
  type StageSeatHolder,
  type StageVideoApi,
} from "@/lib/chatStageVideo";
import { isStageViewerIdentity, stageHandIsOwn, stageHands } from "@/lib/chatStageHand";
import { STAGE_CLOSE_AFTER_MS, closeStageRoom, forgetStageChanges } from "@/lib/chatStageChange";
import { removeStageMember } from "@/lib/chatStageRemove";

vi.mock("@/lib/chatRealtimePublish", () => ({ publishRoomEventAfterResponse: vi.fn() }));
vi.mock("@/lib/chatStageNotifyServer", () => ({ stageNoticeAfterResponse: vi.fn() }));
vi.mock("@/lib/chatAdmin", () => ({ createChatAdminClient: () => null }));

beforeEach(() => {
  forgetStageState();
  forgetStageWebhooks();
  forgetStageChanges();
});

describe("#522: a stage request names its room", () => {
  it("only as text that is a real room: nothing, null, a number or a list is no room (never LB)", () => {
    expect(parseStageRoom("main")).toBe("main");
    expect(parseStageRoom("lb-review")).toBe("lb-review");
    for (const bad of [undefined, null, "", "nowhere", "Main", " main", 7, 0, true, ["main"], { room: "main" }]) expect(parseStageRoom(bad)).toBeNull();
  });
  it("reads a body only when it is a JSON object", async () => {
    const body = (text: string) => stageBody({ json: async () => JSON.parse(text) });
    expect(await body('{"room":"main"}')).toEqual({ room: "main" });
    expect(await body("{}")).toEqual({});
    for (const bad of ["null", "[]", '["main"]', '"main"', "7", "true", "not json", ""]) expect(await body(bad)).toBeNull();
  });
});

describe("#522: a stage POST says where it came from", () => {
  const from = (headers: Record<string, string>) =>
    stageOriginAllowed({ headers: { get: (name: string) => headers[name.toLowerCase()] ?? null } });
  const site = { host: "chat.robbooker.com" };
  it("what real browsers send from the chat's own pages is accepted", () => {
    // Chrome, Firefox, Safari 16.4+, and the installed app on Android and iOS: Origin, Sec-Fetch-Site and Referer.
    expect(from({ ...site, origin: "https://chat.robbooker.com", "sec-fetch-site": "same-origin", referer: "https://chat.robbooker.com/chat?room=main" })).toBe(true);
    // An older Safari (before 16.4): Origin and Referer, no Sec-Fetch-Site.
    expect(from({ ...site, origin: "https://chat.robbooker.com", referer: "https://chat.robbooker.com/chat" })).toBe(true);
    // A privacy setting that strips the Referer: Origin is enough.
    expect(from({ ...site, origin: "https://chat.robbooker.com" })).toBe(true);
    // Something stripped Origin: the browser's own Sec-Fetch-Site, or failing that the Referer, vouches.
    expect(from({ ...site, "sec-fetch-site": "same-origin" })).toBe(true);
    expect(from({ ...site, referer: "https://chat.robbooker.com/chat?room=main&stage=1" })).toBe(true);
    // Behind the proxy the forwarded host is the site's name.
    expect(from({ host: "internal:3000", "x-forwarded-host": "chat.robbooker.com", origin: "https://chat.robbooker.com" })).toBe(true);
    expect(from({ host: "localhost:3503", origin: "http://localhost:3503" })).toBe(true);
  });
  it("anything else is refused: no word at all, another site, a sandboxed frame", () => {
    expect(from(site)).toBe(false);
    expect(from({})).toBe(false);
    expect(from({ origin: "https://chat.robbooker.com" })).toBe(false);
    expect(from({ ...site, origin: "https://evil.test" })).toBe(false);
    expect(from({ ...site, origin: "https://evil.test", "sec-fetch-site": "same-origin", referer: "https://chat.robbooker.com/" })).toBe(false);
    expect(from({ ...site, origin: "null" })).toBe(false);
    expect(from({ ...site, origin: "https://chat.robbooker.com.evil.test" })).toBe(false);
    expect(from({ ...site, origin: "https://chat.robbooker.com:8443" })).toBe(false);
    for (const value of ["cross-site", "same-site", "none"]) expect(from({ ...site, "sec-fetch-site": value })).toBe(false);
    // Sec-Fetch-Site says another site: a Referer cannot overrule the browser.
    expect(from({ ...site, "sec-fetch-site": "cross-site", referer: "https://chat.robbooker.com/chat" })).toBe(false);
    expect(from({ ...site, referer: "https://evil.test/chat.robbooker.com" })).toBe(false);
    expect(from({ ...site, referer: "not a url" })).toBe(false);
    expect(from({ host: "internal:3000", "x-forwarded-host": "chat.robbooker.com", origin: "http://internal:3000" })).toBe(false);
  });
});

describe("#522: two seats per member per video room", () => {
  const holder = (joinedAt: number, tab?: string): StageSeatHolder => ({ joinedAt, ...(tab ? { tab } : {}) });
  it("there are two, and their identities are still viewer identities the hand rules know", () => {
    expect(STAGE_VIEWER_SEATS).toBe(2);
    expect(stageViewerIdentities("member-bob")).toEqual(["member-bob#00000001", "member-bob#00000002"]);
    for (const identity of stageViewerIdentities("member-bob")) {
      expect(isStageViewerIdentity(identity)).toBe(true);
      expect(stageHandIsOwn("member-bob", identity)).toBe(true);
      expect(stageHandIsOwn("member-bo", identity)).toBe(false);
    }
    expect(stageViewerIdentity("member-bob", 1)).not.toBe(stageViewerIdentity("member-bobby", 1));
    // Two tabs with a hand up still count once.
    const hands = stageHands(stageViewerIdentities("member-bob").map((identity, i) => ({ identity, name: "Bob", hand: String(1000 + i) })));
    expect(hands).toEqual([{ member: "member-bob", name: "Bob", at: 1000, identities: ["member-bob#00000001", "member-bob#00000002"] }]);
  });
  it("a new screen takes the seat it asks for when free, else the free one", () => {
    expect(pickStageSeat([null, null], "taba123456", 1)).toBe(1);
    expect(pickStageSeat([null, null], "taba123456", 2)).toBe(2);
    expect(pickStageSeat([holder(5, "other12345"), null], "taba123456", 1)).toBe(2);
    expect(pickStageSeat([null, holder(5, "other12345")], "taba123456", 2)).toBe(1);
    for (const odd of [0, 3, -1, 1.5, Number.NaN]) expect(pickStageSeat([null, null], null, odd)).toBe(1);
  });
  it("the same tab reconnecting gets its own seat back, wherever it asks", () => {
    const seats = [holder(100, "phone12345"), holder(900, "taba123456")];
    expect(pickStageSeat(seats, "taba123456", 1)).toBe(2);
    expect(pickStageSeat(seats, "phone12345", 2)).toBe(1);
  });
  it("a third screen replaces the one that joined longest ago", () => {
    expect(pickStageSeat([holder(100, "a123456789"), holder(900, "b123456789")], "c123456789", 2)).toBe(1);
    expect(pickStageSeat([holder(900, "a123456789"), holder(100, "b123456789")], "c123456789", 1)).toBe(2);
    expect(pickStageSeat([holder(100), holder(900)], null, 2)).toBe(1);
  });
  it("takes a tab's name only as a short plain value", () => {
    expect(parseStageTab("k3j9x0a7bq")).toBe("k3j9x0a7bq");
    for (const bad of [undefined, null, "", "short", "UPPERCASE1", "has space1", "<script>", "x".repeat(25), 12345678]) expect(parseStageTab(bad)).toBeNull();
  });
  it("asks LiveKit once per seat, and still answers one of the two seats when LiveKit cannot say", async () => {
    const asked: string[] = [];
    const api = (seats: Record<string, StageSeatHolder>, fail = false): Pick<StageVideoApi, "viewer"> => ({
      viewer: async (room, identity) => {
        asked.push(`${room}:${identity}`);
        if (fail) throw new Error("down");
        return seats[identity] ?? null;
      },
    });
    expect(await stageSeatFor(api({}), "chat-main", "m1", "taba123456", 2)).toBe("m1#00000002");
    expect(asked).toEqual(["chat-main:m1#00000001", "chat-main:m1#00000002"]);
    expect(await stageSeatFor(api({ "m1#00000002": holder(5, "other12345") }), "chat-main", "m1", "taba123456", 2)).toBe("m1#00000001");
    expect(await stageSeatFor(api({ "m1#00000001": holder(5, "taba123456"), "m1#00000002": holder(1, "other12345") }), "chat-main", "m1", "taba123456", 2)).toBe("m1#00000001");
    expect(await stageSeatFor(api({}, true), "chat-main", "m1", "taba123456", 2)).toBe("m1#00000002");
    expect(await stageSeatFor(api({}, true), "chat-main", "m1", null, 7)).toBe("m1#00000001");
  });
  it("however many tokens are asked for, on servers that share nothing, a member only ever has two identities", async () => {
    // LiveKit: one connection per identity; a join with a taken identity replaces it.
    const connected = new Map<string, StageSeatHolder>();
    const api: Pick<StageVideoApi, "viewer"> = { viewer: async (_room, identity) => connected.get(identity) ?? null };
    let clock = 0;
    // 300 tokens: tabs that come and go, three "servers" answering in turn (none remembers anything
    // between calls, which is the point), some joining late, some never joining at all.
    const pending: { identity: string; tab: string }[] = [];
    for (let i = 0; i < 300; i++) {
      const tab = `tab${String(i % 7).padStart(7, "0")}`;
      pending.push({ identity: await stageSeatFor(api, "chat-main", "member-bob", tab, (i % 2) + 1), tab });
      if (i % 3 !== 2) {
        const joining = pending.splice(i % 5 === 0 ? 0 : pending.length - 1, 1)[0];
        connected.set(joining.identity, { joinedAt: ++clock, tab: joining.tab });
      }
      expect(connected.size).toBeLessThanOrEqual(STAGE_VIEWER_SEATS);
    }
    for (const late of pending) connected.set(late.identity, { joinedAt: ++clock, tab: late.tab });
    expect([...connected.keys()].sort()).toEqual(stageViewerIdentities("member-bob"));
  });
});

describe("#522: a webhook with no id", () => {
  it("is never new (it could not be told from a repeat); one with an id is new once", () => {
    expect(stageWebhookIsNew("")).toBe(false);
    expect(stageWebhookIsNew("")).toBe(false);
    expect(stageWebhookIsNew("EV_1")).toBe(true);
    expect(stageWebhookIsNew("EV_1")).toBe(false);
  });
});

describe("#523: a state is acted on once", () => {
  it("is news the first time and when it changes, and says what it was before", () => {
    expect(stageStateNews("main", "waiting")).toEqual({ before: null });
    expect(stageStateNews("main", "waiting")).toBeNull();
    expect(stageStateNews("main", "live")).toEqual({ before: "waiting" });
    for (let i = 0; i < 5; i++) expect(stageStateNews("main", "live")).toBeNull();
    expect(stageStateNews("main", "waiting")).toEqual({ before: "live" });
    // Per room.
    expect(stageStateNews("social", "waiting")).toEqual({ before: null });
  });
  it("the status's own reads see a stop only when this server had read live", () => {
    expect(stageStopSeen("main", "waiting")).toBe(false);
    expect(stageStopSeen("main", "live")).toBe(false);
    expect(stageStopSeen("main", "live")).toBe(false);
    expect(stageStopSeen("main", "waiting")).toBe(true);
    expect(stageStopSeen("main", "waiting")).toBe(false);
    expect(stageStopSeen("main", "live")).toBe(false);
    expect(stageStopSeen("main", "off")).toBe(true);
  });
});

describe("#523: what one server remembers about a room", () => {
  it("waiting and off: half a minute for a caller that accepts it, a few seconds for everyone else; live: always a few seconds", async () => {
    for (const settled of ["waiting", "off"] as const) {
      forgetStageState();
      const read = vi.fn(async () => settled);
      await sharedStageState("main", read, 1_000);
      await sharedStageState("main", read, 1_000 + STAGE_SETTLED_MEMORY_MS - 1, { longMemory: true });
      expect(read).toHaveBeenCalledTimes(1);
      // A caller that does not ask for the long memory (the token route, a signalled status read) reads again.
      await sharedStageState("main", read, 1_000 + STAGE_STATE_MEMORY_MS);
      expect(read).toHaveBeenCalledTimes(2);
      await sharedStageState("main", read, 1_000 + STAGE_STATE_MEMORY_MS + STAGE_SETTLED_MEMORY_MS, { longMemory: true });
      expect(read).toHaveBeenCalledTimes(3);
    }
    forgetStageState();
    const live = vi.fn(async () => "live" as const);
    await sharedStageState("main", live, 1_000, { longMemory: true });
    await sharedStageState("main", live, 1_000 + STAGE_STATE_MEMORY_MS - 1, { longMemory: true });
    expect(live).toHaveBeenCalledTimes(1);
    await sharedStageState("main", live, 1_000 + STAGE_STATE_MEMORY_MS, { longMemory: true });
    expect(live).toHaveBeenCalledTimes(2);
  });
  it("a failed read is remembered only for the few seconds, whoever asks", async () => {
    const read = vi.fn(async (): Promise<"waiting"> => {
      throw new Error("down");
    });
    expect(await sharedStageState("main", read, 1_000, { longMemory: true })).toBe("off");
    expect(await sharedStageState("main", read, 1_000 + STAGE_STATE_MEMORY_MS - 1, { longMemory: true })).toBe("off");
    expect(read).toHaveBeenCalledTimes(1);
    await sharedStageState("main", read, 1_000 + STAGE_STATE_MEMORY_MS, { longMemory: true });
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("forgetting a room (a webhook, an admin's action) ends the long memory at once", async () => {
    const read = vi.fn(async () => "waiting" as const);
    await sharedStageState("main", read, 1_000, { longMemory: true });
    forgetStageState("main");
    await sharedStageState("main", read, 1_001, { longMemory: true });
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("the stock on screen is remembered long only for a caller that asks", async () => {
    const read = vi.fn(async () => ({ symbol: "APUS", at: 5 }));
    await sharedStageOnScreen("main", read, 1_000);
    await sharedStageOnScreen("main", read, 1_000 + STAGE_STATE_MEMORY_MS);
    expect(read).toHaveBeenCalledTimes(2);
    await sharedStageOnScreen("main", read, 1_000 + STAGE_STATE_MEMORY_MS + 20_000, { longMemory: true });
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe("#522: nobody lingers after a broadcast", () => {
  const api = (publishing: () => boolean, fail = false) => {
    const calls: string[] = [];
    const fake = {
      calls,
      ingresses: async (room: string) => {
        calls.push(`list:${room}`);
        return [{ id: "IN_1", url: "x", streamKey: "FAKE", publishing: publishing() }];
      },
      closeRoom: async (room: string) => {
        calls.push(`close:${room}`);
        if (fail) throw new Error("down");
      },
    };
    return fake as unknown as StageVideoApi & { calls: string[] };
  };
  it("waits until after the player's own 25-second goodbye, looks once more, and closes the LiveKit room if the broadcast is still off", async () => {
    expect(STAGE_CLOSE_AFTER_MS).toBe(30_000);
    const waits: number[] = [];
    const fake = api(() => false);
    expect(await closeStageRoom("main", fake, undefined, async (ms) => void waits.push(ms))).toBe("closed");
    expect(waits).toEqual([30_000]);
    expect(fake.calls).toEqual(["list:chat-main", "close:chat-main"]);
  });
  it("leaves the room alone when the broadcast came back within the grace", async () => {
    let back = false;
    const fake = api(() => back);
    expect(await closeStageRoom("main", fake, 20_000, async () => void (back = true))).toBe("live");
    expect(fake.calls).toEqual(["list:chat-main"]);
  });
  it("closes once however many things report the same stop, and at once (no look) after a reset key", async () => {
    let release!: () => void;
    const fake = api(() => false);
    const first = closeStageRoom("main", fake, 20_000, () => new Promise<void>((resolve) => (release = resolve)));
    expect(await closeStageRoom("main", fake, 20_000, async () => undefined)).toBe("busy");
    expect(await closeStageRoom("main", fake, 20_000, async () => undefined)).toBe("busy");
    // Another room is its own.
    expect(await closeStageRoom("social", fake, 20_000, async () => undefined)).toBe("closed");
    release();
    expect(await first).toBe("closed");
    expect(fake.calls.filter((call) => call === "close:chat-main")).toHaveLength(1);
    const reset = api(() => true);
    expect(await closeStageRoom("main", reset, 0)).toBe("closed");
    expect(reset.calls).toEqual(["close:chat-main"]);
  });
  it("never throws, and can try again after a failure", async () => {
    expect(await closeStageRoom("main", api(() => false, true), 20_000, async () => undefined)).toBe("failed");
    expect(await closeStageRoom("main", api(() => false), 20_000, async () => undefined)).toBe("closed");
  });
});

describe("#522: a member who loses access stops watching", () => {
  it("is removed from every chat video room that exists, both seats, with their held tokens revoked; nothing else is touched", async () => {
    const calls: string[] = [];
    const inRoom = new Set(["chat-main|member-bob#00000002", "chat-gainers|member-bob#00000001", "chat-main|member-cara#00000001"]);
    const api = {
      videoRooms: async () => {
        calls.push("rooms");
        return ["chat-main", "some-other-app", "chat-gainers", "chat-nowhere"];
      },
      removeViewer: async (room: string, identity: string, revoke?: boolean) => {
        calls.push(`remove:${room}:${identity}:${revoke}`);
        return inRoom.delete(`${room}|${identity}`);
      },
    };
    expect(await removeStageMember(api, "member-bob")).toBe(2);
    expect(calls).toEqual([
      "rooms",
      "remove:chat-main:member-bob#00000001:true",
      "remove:chat-main:member-bob#00000002:true",
      "remove:chat-gainers:member-bob#00000001:true",
      "remove:chat-gainers:member-bob#00000002:true",
    ]);
    expect([...inRoom]).toEqual(["chat-main|member-cara#00000001"]);
  });
  it("costs one call when no video room exists, and one failed removal does not stop the others", async () => {
    const calls: string[] = [];
    expect(await removeStageMember({ videoRooms: async () => [], removeViewer: async () => void calls.push("remove") as never }, "member-bob")).toBe(0);
    expect(calls).toEqual([]);
    const flaky = {
      videoRooms: async () => ["chat-main"],
      removeViewer: async (_room: string, identity: string) => {
        if (identity.endsWith("1")) throw new Error("down");
        return true;
      },
    };
    expect(await removeStageMember(flaky, "member-bob")).toBe(1);
  });
});

describe("#522/#523: a player's own retries", () => {
  it("a connection that never came up is not retried by itself", () => {
    for (const lost of ["failed", "replaced", "removed"] as const) expect(stageAutoRetry(lost, null, 0)).toBeNull();
  });
  it("a lost connection (the network, or a lapsed token) and a removed viewer each get one fresh attempt", () => {
    expect(stageAutoRetry("failed", 90_000, 0)).toBe(2_000);
    expect(stageAutoRetry("removed", 90_000, 0)).toBe(1_500);
    expect(stageAutoRetry("failed", 5_000, 1)).toBeNull();
    expect(stageAutoRetry("removed", 5_000, 1)).toBeNull();
  });
  it("a replaced connection retries only when it had just been made (two screens picking one seat), never when it was the oldest of three", () => {
    expect(stageAutoRetry("replaced", 800, 0)).toBe(1_000);
    expect(stageAutoRetry("replaced", STAGE_SEAT_RACE_MS - 1, 0)).toBe(1_000);
    expect(stageAutoRetry("replaced", STAGE_SEAT_RACE_MS, 0)).toBeNull();
    expect(stageAutoRetry("replaced", 3_600_000, 0)).toBeNull();
    expect(stageAutoRetry("replaced", 800, 1)).toBeNull();
    expect(STAGE_HEALTHY_MS).toBeGreaterThan(STAGE_SEAT_RACE_MS);
  });
  it("three screens fighting over two seats settle: each retries at most once, so it cannot loop", () => {
    // Every screen starts with its one automatic retry; a kick within the race window uses it.
    const tries = [0, 0, 0];
    let kicks = 0;
    // Worst case: whoever retries always knocks off someone who connected a moment ago.
    for (let round = 0; round < 50; round++) {
      const victim = round % 3;
      const wait = stageAutoRetry("replaced", 500, tries[victim]);
      if (wait === null) continue;
      tries[victim] += 1;
      kicks += 1;
    }
    expect(kicks).toBe(3);
  });
});

describe("#522: a connection the server closed", () => {
  const input: StageLinkInput = { video: true, state: "live", picture: true, dead: false, hidden: false, watching: true };
  it("is let go of once the room is not live, and made again when it is", () => {
    let { memory } = stageLinkStep(STAGE_LINK_IDLE, input, 0);
    expect(memory.open).toBe(true);
    // The broadcast stops; the server closes the room after its grace (the connection is dead).
    ({ memory } = stageLinkStep(memory, { ...input, picture: false, state: "waiting" }, 1_000));
    expect(memory.open).toBe(true);
    const closed = stageLinkStep(memory, { ...input, picture: false, state: "waiting", dead: true }, 20_000);
    expect(closed.memory).toMatchObject({ open: false, closed: "gone", closedLive: false });
    expect(closed.wake).toBeNull();
    // Still waiting: nothing. Live again: a new connection, with no signal needed.
    expect(stageLinkStep(closed.memory, { ...input, picture: false, state: "waiting" }, 30_000).memory.open).toBe(false);
    expect(stageLinkStep(closed.memory, { ...input, picture: false, state: "live" }, 60_000).memory).toMatchObject({ open: true, closed: null });
  });
  it("is kept (dead) while the status still says live, as before: the status is what decides", () => {
    const { memory } = stageLinkStep(STAGE_LINK_IDLE, input, 0);
    const dead = stageLinkStep(memory, { ...input, picture: false, dead: true }, 5_000);
    expect(dead.memory.open).toBe(true);
    expect(dead.wake).toBeNull();
  });
});
