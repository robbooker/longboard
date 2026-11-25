// #503: telling a room its live video is on, once. The database is a small stand-in that keeps the
// one promise the real one makes (an id is inserted at most once); LiveKit is a list of ingresses.
//  - once only: a repeated webhook, two servers at the same moment, two servers either side of a
//    ten-minute line, a reconnect within 10 minutes; a later broadcast is announced again;
//  - the end: the message is rewritten and its alerts are taken back; a short drop changes nothing;
//    #512: with no End button and an ingress that is never deleted, the end is the ingress no
//    longer publishing, however it is noticed (a webhook, an admin's player, the status);
//  - who is told: the room's member list, without bots, "Mentions only"/"Muted" and the acting admin;
//  - the words: the room message, the bell's reading of it and the phone notification.
import { describe, expect, it } from "vitest";
import {
  STAGE_DROP_GRACE_MS,
  STAGE_NOTICE_SLOT_MS,
  STAGE_RECONNECT_MS,
  stageNoticeId,
  stageNoticeIds,
  stageNoticePush,
  stageNoticeRecipients,
  syncStageNotice,
  tellStageEnded,
  tellStageLive,
  type StageNotice,
  type StageNoticeStore,
  type StageRecipientReads,
} from "@/lib/chatStageNotify";
import { composeStageEndedNotice, composeStageLiveNotice, stageLiveNotice, stageLivePush, stageNoticeAuthor, STAGE_NOTICE_AUTHOR } from "@/lib/chatStageNotice";
import { isReservedChatName } from "@/lib/publicChat";
import type { ChatRoom } from "@/lib/publicChat";

const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 25, 14, 30, 0) + 3 * MIN; // three minutes into a ten-minute slot
const ORIGIN = "https://chat.example.test";
const LIVE = "🔴 LB is live now. Watch live: https://chat.example.test/chat?room=main&stage=1";
const ENDED = "The live video in LB has ended.";

/** The database as these rules see it. `tick` lets two callers interleave at every step. */
function fakeStore(members: string[] = ["acct-bob", "acct-cara"]) {
  const rows = new Map<string, StageNotice & { room: ChatRoom }>();
  const state = { clock: T0, notified: [] as { id: string; room: ChatRoom; accounts: string[] }[], withdrawn: [] as string[], posts: 0, recipientReads: 0 };
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
  const store: StageNoticeStore = {
    notices: async (ids) => {
      await tick();
      return ids.flatMap((id) => (rows.has(id) ? [{ ...rows.get(id)! }] : []));
    },
    post: async (id, room, body) => {
      await tick();
      state.posts++;
      if (rows.has(id)) return false;
      rows.set(id, { id, room, body, createdAt: state.clock, editedAt: null, revision: 0 });
      return true;
    },
    rewrite: async (_room, notice, body) => {
      await tick();
      const row = rows.get(notice.id);
      if (!row || row.revision !== notice.revision) return false;
      rows.set(notice.id, { ...row, body, editedAt: state.clock, revision: row.revision + 1 });
      return true;
    },
    recipients: async () => {
      state.recipientReads++;
      await tick();
      return members;
    },
    notify: async (id, room, accounts) => {
      await tick();
      state.notified.push({ id, room, accounts });
    },
    withdraw: async (id) => {
      state.withdrawn.push(id);
    },
  };
  const live = (room: ChatRoom, now: number, startedAt?: number | null) => {
    state.clock = now;
    return tellStageLive(store, room, { now, startedAt, origin: ORIGIN });
  };
  const end = (room: ChatRoom, now: number) => {
    state.clock = now;
    return tellStageEnded(store, room, now);
  };
  return { store, rows, state, live, end, bodies: () => [...rows.values()].map((row) => row.body) };
}

describe("the words", () => {
  it("the room message names the room, never a person, and links to the stage", () => {
    expect(composeStageLiveNotice("LB", `${ORIGIN}/`, "main")).toBe(LIVE);
    expect(stageLiveNotice(LIVE)).toEqual({ before: "🔴 LB is live now. ", label: "Watch live", href: "/chat?room=main&stage=1", room: "main", roomName: "LB" });
    expect(stageLiveNotice(composeStageLiveNotice("Booker Stock Club", ORIGIN, "club"))).toMatchObject({ href: "/chat?room=club&stage=1", roomName: "Booker Stock Club" });
  });
  it("the ended message, an ordinary announcement and a look-alike are not live notices", () => {
    expect(composeStageEndedNotice("LB")).toBe(ENDED);
    for (const body of [ENDED, "LB is live now.", `${LIVE} and more`, `Hello\n${LIVE}`, "🔴 LB is live now. Watch live: https://evil.test/elsewhere?room=main&stage=1", "🔴 LB is live now. Watch live: javascript:alert(1)"])
      expect(stageLiveNotice(body), body).toBeNull();
  });
  it("#504: the notice is shown as Live Video, live or ended; the bot's other posts keep their name", () => {
    expect(STAGE_NOTICE_AUTHOR).toBe("Live Video");
    expect(stageNoticeAuthor("longboard", LIVE)).toBe("Live Video");
    expect(stageNoticeAuthor("longboard", ENDED)).toBe("Live Video");
    expect(stageNoticeAuthor("longboard", composeStageEndedNotice("Booker Stock Club"))).toBe("Live Video");
    for (const body of ["Profile pictures are here.", `${LIVE} and more`, `Hello\n${ENDED}`, "The live video in LB has ended. More soon."])
      expect(stageNoticeAuthor("longboard", body), body).toBeNull();
    // Never a person's message, or another bot's, that copies the words.
    for (const bot of [null, undefined, "buddy", "club"]) expect(stageNoticeAuthor(bot, LIVE)).toBeNull();
    expect(stageNoticeAuthor("longboard", null)).toBeNull();
    // Nobody can take the name.
    expect(isReservedChatName("Live Video")).toBe(true);
    expect(isReservedChatName(" live  video ")).toBe(true);
  });
  it("the phone notification says the room is live and opens the stage link", () => {
    expect(stageLivePush("LB", "main")).toEqual({ title: "LB is live now", body: "Live video has started. Watch on a computer for now.", url: "/chat?room=main&stage=1" });
  });
});

describe("once per broadcast", () => {
  it("a new broadcast: one message, and the room's members are told once", async () => {
    const db = fakeStore();
    expect(await db.live("main", T0, T0 - 2_000)).toBe("announced");
    expect(db.bodies()).toEqual([LIVE]);
    expect(db.state.notified).toEqual([{ id: stageNoticeId("main", Math.floor(T0 / STAGE_NOTICE_SLOT_MS)), room: "main", accounts: ["acct-bob", "acct-cara"] }]);
  });
  it("a repeated webhook, a retry and the admin's player all find the notice already there", async () => {
    const db = fakeStore();
    await db.live("main", T0, T0);
    for (const later of [50, 900, 30_000, 4 * MIN, 45 * MIN, 3 * 60 * MIN]) expect(await db.live("main", T0 + later, T0)).toBe("already");
    expect(db.rows.size).toBe(1);
    expect(db.state.notified).toHaveLength(1);
    // Nothing was even attempted, and nobody's list was read again.
    expect(db.state.posts).toBe(1);
    expect(db.state.recipientReads).toBe(1);
  });
  it("two servers at the same moment: both try the same id, one creates it, one notifies", async () => {
    const db = fakeStore();
    const results = await Promise.all(Array.from({ length: 6 }, () => db.live("main", T0, T0 - 1_000)));
    expect(results.filter((result) => result === "announced")).toHaveLength(1);
    expect(results.filter((result) => result === "already")).toHaveLength(5);
    expect(db.state.posts).toBe(6); // all six really raced: each read "no notice" before any insert
    expect(db.rows.size).toBe(1);
    expect(db.state.notified).toHaveLength(1);
  });
  it("two servers either side of a ten-minute line still agree, because the id comes from LiveKit's start time", async () => {
    const db = fakeStore();
    const line = Math.ceil(T0 / STAGE_NOTICE_SLOT_MS) * STAGE_NOTICE_SLOT_MS;
    const startedAt = line - 400;
    const results = await Promise.all([db.live("main", line - 20, startedAt), db.live("main", line + 20, startedAt), db.live("main", line + 900, startedAt)]);
    expect(results.filter((result) => result === "announced")).toHaveLength(1);
    expect(db.rows.size).toBe(1);
    expect(db.state.notified).toHaveLength(1);
  });
  it("without a start time from LiveKit the server's clock picks the slot, and two calls in it still make one notice", async () => {
    const db = fakeStore();
    const results = await Promise.all([db.live("main", T0, null), db.live("main", T0 + 40, undefined)]);
    expect(results.sort()).toEqual(["already", "announced"]);
    expect(db.state.notified).toHaveLength(1);
  });
  it("rooms are separate: each is told about its own broadcast", async () => {
    const db = fakeStore();
    expect(await db.live("main", T0, T0)).toBe("announced");
    expect(await db.live("shortscout", T0, T0)).toBe("announced");
    expect(db.state.notified.map((sent) => sent.room)).toEqual(["main", "shortscout"]);
    expect(stageNoticeIds("main", T0).some((id) => stageNoticeIds("shortscout", T0).includes(id))).toBe(false);
  });
  it("a refused post (a paused room, a room the bot may not post in) notifies nobody", async () => {
    const db = fakeStore();
    db.store.post = async () => {
      throw new Error("stage_notice_post");
    };
    await expect(db.live("gainers", T0, T0)).rejects.toThrow("stage_notice_post");
    expect(db.state.notified).toEqual([]);
  });
});

describe("the broadcast ends, drops and comes back", () => {
  it("ending rewrites the same message and takes its alerts back, once", async () => {
    const db = fakeStore();
    await db.live("main", T0, T0);
    const [id] = db.rows.keys();
    expect(await db.end("main", T0 + 50 * MIN)).toBe(true);
    expect(db.bodies()).toEqual([ENDED]);
    expect(db.state.withdrawn).toEqual([id]);
    // A second end signal (ingress_ended, room_finished, a status read) finds nothing live.
    expect(await db.end("main", T0 + 50 * MIN + 500)).toBe(false);
    expect(await Promise.all([db.end("main", T0 + 51 * MIN), db.end("main", T0 + 51 * MIN)])).toEqual([false, false]);
    expect(db.state.withdrawn).toEqual([id]);
    expect(db.state.notified).toHaveLength(1);
  });
  it("two servers ending at once rewrite it once", async () => {
    const db = fakeStore();
    await db.live("main", T0, T0);
    expect((await Promise.all([db.end("main", T0 + MIN), db.end("main", T0 + MIN)])).sort()).toEqual([false, true]);
    expect(db.state.withdrawn).toHaveLength(1);
  });
  it("nothing to end: no notice, or a room that was never live", async () => {
    const db = fakeStore();
    expect(await db.end("main", T0)).toBe(false);
    expect(db.rows.size).toBe(0);
  });
  it("back within 10 minutes of ending is the same broadcast: the message says live again and nobody is told twice", async () => {
    const db = fakeStore();
    await db.live("main", T0, T0);
    await db.end("main", T0 + 20 * MIN);
    const back = T0 + 20 * MIN + STAGE_RECONNECT_MS - 1_000;
    // StreamYard reconnecting is a new session at LiveKit, with a new start time.
    expect(await Promise.all([db.live("main", back, back - 500), db.live("main", back + 30, back - 500)])).toEqual(["resumed", "resumed"]);
    expect(db.bodies()).toEqual([LIVE]);
    expect(db.rows.size).toBe(1);
    expect(db.state.notified).toHaveLength(1);
    expect(await db.live("main", back + 5_000, back - 500)).toBe("already");
    // And it can end again.
    expect(await db.end("main", back + 30 * MIN)).toBe(true);
    expect(db.bodies()).toEqual([ENDED]);
  });
  it("a new broadcast later (10 minutes or more after the end) is announced again, in its own message", async () => {
    const db = fakeStore();
    await db.live("main", T0, T0);
    await db.end("main", T0 + 30 * MIN);
    const next = T0 + 30 * MIN + STAGE_RECONNECT_MS;
    expect(await Promise.all([db.live("main", next, next - 800), db.live("main", next + 10, next - 800)])).toEqual(expect.arrayContaining(["announced", "already"]));
    expect(db.bodies()).toEqual([ENDED, LIVE]);
    expect(db.state.notified).toHaveLength(2);
    expect(db.state.notified[0].id).not.toBe(db.state.notified[1].id);
    // The next day too.
    await db.end("main", next + 60 * MIN);
    expect(await db.live("main", next + 24 * 60 * MIN, next + 24 * 60 * MIN)).toBe("announced");
    expect(db.state.notified).toHaveLength(3);
  });
  it("a start time that belongs to an earlier, finished broadcast does not hide a new one", async () => {
    const db = fakeStore();
    await db.live("main", T0, T0);
    await db.end("main", T0 + 2 * MIN);
    // LiveKit still reports the first start time, 40 minutes on: the clock's slot is used instead.
    expect(await db.live("main", T0 + 40 * MIN, T0)).toBe("announced");
    expect(db.rows.size).toBe(2);
    expect(db.state.notified).toHaveLength(2);
    expect(await db.live("main", T0 + 40 * MIN + 100, T0)).toBe("already");
  });
  it("a notice whose end was never seen stops counting after 6 hours", async () => {
    const db = fakeStore();
    await db.live("main", T0, T0);
    expect(await db.live("main", T0 + 5 * 60 * MIN, T0 + 5 * 60 * MIN)).toBe("already");
    expect(await db.live("main", T0 + 7 * 60 * MIN, T0 + 7 * 60 * MIN)).toBe("announced");
  });
});

describe("following LiveKit (syncStageNotice)", () => {
  type Ingress = { publishing: boolean; startedAt?: number };
  function setup(first: Ingress[]) {
    const db = fakeStore();
    const lk = { ingresses: first, reads: 0, waits: [] as number[], afterWait: null as Ingress[] | null, now: T0 };
    const sync = () =>
      syncStageNotice(
        {
          store: db.store,
          ingresses: async () => {
            lk.reads++;
            return lk.ingresses;
          },
          wait: async (ms) => {
            lk.waits.push(ms);
            if (lk.afterWait) lk.ingresses = lk.afterWait;
          },
          now: () => ((db.state.clock = lk.now), lk.now),
          origin: ORIGIN,
        },
        "main",
      );
    return { db, lk, sync };
  }
  it("a room having its stream key announces nothing: only video arriving does", async () => {
    const { db, lk, sync } = setup([{ publishing: false }]);
    expect(await sync()).toBe("none");
    expect(lk.waits).toEqual([]);
    lk.ingresses = [];
    expect(await sync()).toBe("none");
    expect(db.rows.size).toBe(0);
    lk.ingresses = [{ publishing: true, startedAt: T0 }];
    expect(await sync()).toBe("announced");
    expect(await sync()).toBe("already");
    expect(db.state.notified).toHaveLength(1);
  });
  it("a hint that it is live, while LiveKit says it is not, announces nothing", async () => {
    const { db, sync } = setup([{ publishing: false }]);
    expect(await sync()).toBe("none");
    expect(db.state.notified).toEqual([]);
  });
  it("a short drop: the message is left alone when the broadcast is back within the grace", async () => {
    const { db, lk, sync } = setup([{ publishing: true, startedAt: T0 }]);
    await sync();
    lk.ingresses = [{ publishing: false }];
    lk.afterWait = [{ publishing: true, startedAt: T0 + 30_000 }];
    lk.now = T0 + 31_000;
    expect(await sync()).toBe("already");
    expect(lk.waits).toEqual([STAGE_DROP_GRACE_MS]);
    expect(db.bodies()).toEqual([LIVE]);
    expect(db.state.withdrawn).toEqual([]);
    expect(db.state.notified).toHaveLength(1);
  });
  it("a drop that lasts: the message says it ended; an ingress deleted at LiveKit marks it at once", async () => {
    const dropped = setup([{ publishing: true, startedAt: T0 }]);
    await dropped.sync();
    dropped.lk.ingresses = [{ publishing: false }];
    expect(await dropped.sync()).toBe("ended");
    expect(dropped.lk.waits).toEqual([STAGE_DROP_GRACE_MS]);
    expect(dropped.db.bodies()).toEqual([ENDED]);
    const ended = setup([{ publishing: true, startedAt: T0 }]);
    await ended.sync();
    ended.lk.ingresses = [];
    expect(await ended.sync()).toBe("ended");
    expect(ended.lk.waits).toEqual([]);
    expect(await ended.sync()).toBe("none");
  });
  it("#512: one permanent ingress, no End button: each broadcast is announced, and ended when it stops publishing", async () => {
    // The room's ingress exists before, between and after broadcasts: the state is never "off".
    const { db, lk, sync } = setup([{ publishing: false }]);
    expect(await sync()).toBe("none");
    // StreamYard goes live.
    lk.ingresses = [{ publishing: true, startedAt: T0 }];
    expect(await sync()).toBe("announced");
    expect(db.state.notified).toHaveLength(1);
    const first = db.state.notified[0].id;
    // StreamYard stops. The ingress stays; nothing else says "end". Three hints at once (LiveKit's
    // webhook, an admin's player, a member's status read): one rewrite, the alerts taken back once.
    lk.ingresses = [{ publishing: false, startedAt: T0 }];
    lk.now = T0 + 40 * MIN;
    expect((await Promise.all([sync(), sync(), sync()])).sort()).toEqual(["ended", "none", "none"]);
    expect(lk.waits).toEqual([STAGE_DROP_GRACE_MS, STAGE_DROP_GRACE_MS, STAGE_DROP_GRACE_MS]);
    expect(db.bodies()).toEqual([ENDED]);
    expect(db.state.withdrawn).toEqual([first]);
    // Later hints while it rests at "waiting" (the once-a-minute look) do nothing and wait for nothing.
    lk.waits.length = 0;
    lk.now = T0 + 45 * MIN;
    expect(await sync()).toBe("none");
    expect(lk.waits).toEqual([]);
    // Back five minutes after the end: the same broadcast, the same message, nobody told again.
    lk.ingresses = [{ publishing: true, startedAt: T0 + 45 * MIN }];
    expect(await sync()).toBe("resumed");
    expect(db.bodies()).toEqual([LIVE]);
    expect(db.state.notified).toHaveLength(1);
    lk.ingresses = [{ publishing: false }];
    lk.now = T0 + 60 * MIN;
    expect(await sync()).toBe("ended");
    // The next broadcast on the same ingress, the same afternoon: its own message, everyone told.
    lk.ingresses = [{ publishing: true, startedAt: T0 + 120 * MIN }];
    lk.now = T0 + 120 * MIN + 2_000;
    expect(await sync()).toBe("announced");
    expect(db.bodies()).toEqual([ENDED, LIVE]);
    expect(db.state.notified).toHaveLength(2);
    expect(db.state.notified[1].id).not.toBe(first);
    // And it ends the same way, with the ingress still there.
    lk.ingresses = [{ publishing: false }];
    lk.now = T0 + 150 * MIN;
    expect(await sync()).toBe("ended");
    expect(db.bodies()).toEqual([ENDED, ENDED]);
    expect(db.state.withdrawn).toHaveLength(3);
    expect(await sync()).toBe("none");
  });
  it("#512: an end nobody signalled is still marked by the next look, however late, and the next broadcast is announced", async () => {
    const { db, lk, sync } = setup([{ publishing: true, startedAt: T0 }]);
    expect(await sync()).toBe("announced");
    // It stopped; LiveKit's webhook was lost and no admin was watching. Two hours pass.
    lk.ingresses = [{ publishing: false }];
    lk.now = T0 + 120 * MIN;
    // Someone opens the room: the status asks for a look.
    expect(await sync()).toBe("ended");
    expect(db.bodies()).toEqual([ENDED]);
    lk.ingresses = [{ publishing: true, startedAt: T0 + 180 * MIN }];
    lk.now = T0 + 180 * MIN;
    expect(await sync()).toBe("announced");
    expect(db.state.notified).toHaveLength(2);
  });
  it("a LiveKit outage changes nothing", async () => {
    const { db, sync } = setup([{ publishing: true, startedAt: T0 }]);
    await sync();
    const failing = syncStageNotice({ store: db.store, ingresses: async () => Promise.reject(new Error("down")), wait: async () => undefined, now: () => T0, origin: ORIGIN }, "main");
    await expect(failing).rejects.toThrow("down");
    expect(db.bodies()).toEqual([LIVE]);
  });
});

describe("who is told (stageNoticeRecipients)", () => {
  const PAGE = 3;
  function reads(over: Partial<StageRecipientReads> & { list?: string[]; refuse?: string[] } = {}) {
    const list = over.list ?? ["m1", "m2", "m3", "m4", "m5", "m6", "m7"];
    const asked: string[] = [];
    const value: StageRecipientReads = {
      readers: async () => ["acct-admin", "acct-owner"],
      members: async (reader, room, cursor) => {
        asked.push(`${reader}:${room}:${cursor ?? ""}`);
        if (over.refuse?.includes(reader)) return null;
        const from = cursor ? list.indexOf(cursor) + 1 : 0;
        return list.slice(from, from + PAGE);
      },
      accounts: async (ids) => ids.map((id) => id.replace("m", "acct-")),
      bots: async () => [],
      quiet: async () => [],
      ...over,
    };
    return { value, asked };
  }
  it("everyone on the room's member list, page after page", async () => {
    const { value, asked } = reads();
    expect(await stageNoticeRecipients(value, "main")).toEqual(["acct-1", "acct-2", "acct-3", "acct-4", "acct-5", "acct-6", "acct-7"]);
    expect(asked).toEqual(["acct-admin:main:", "acct-admin:main:m3", "acct-admin:main:m6", "acct-admin:main:m7"]);
  });
  it("only that list: someone who cannot read the room is never on it, so is never told", async () => {
    const { value } = reads({ list: ["m2"] });
    expect(await stageNoticeRecipients(value, "shortscout")).toEqual(["acct-2"]);
    expect(await stageNoticeRecipients(reads({ list: [] }).value, "shortscout")).toEqual([]);
  });
  it("no bots, nobody who muted the room or chose Mentions only, and not the admin whose action it is", async () => {
    const { value } = reads({ bots: async () => ["acct-3"], quiet: async (room) => (room === "main" ? ["acct-5", "acct-6"] : []) });
    expect(await stageNoticeRecipients(value, "main", "acct-1")).toEqual(["acct-2", "acct-4", "acct-7"]);
    // Another room's mute does not count here.
    expect(await stageNoticeRecipients(value, "social", null)).toEqual(["acct-1", "acct-2", "acct-4", "acct-5", "acct-6", "acct-7"]);
  });
  it("each account once, even with two member rows", async () => {
    const { value } = reads({ accounts: async () => ["acct-1", "acct-1", "acct-2"] });
    expect(await stageNoticeRecipients(value, "main")).toEqual(["acct-1", "acct-2"]);
  });
  it("uses the next reader when one cannot read the room's list; with none, nobody is told", async () => {
    const one = reads({ refuse: ["acct-admin"] });
    expect(await stageNoticeRecipients(one.value, "main")).toHaveLength(7);
    expect(one.asked[0]).toBe("acct-admin:main:");
    expect(one.asked[1]).toBe("acct-owner:main:");
    expect(await stageNoticeRecipients(reads({ refuse: ["acct-admin", "acct-owner"] }).value, "main")).toEqual([]);
    expect(await stageNoticeRecipients(reads({ readers: async () => [] }).value, "main")).toEqual([]);
  });
});

describe("the phone notification (stageNoticePush)", () => {
  const id = stageNoticeId("main", Math.floor(T0 / STAGE_NOTICE_SLOT_MS));
  it("a live notice's alert says the room is live and opens the stage link", () => {
    expect(stageNoticePush(`/chat?room=main&thread=${id}`, T0 + 2 * MIN)).toEqual({ title: "LB is live now", body: "Live video has started. Watch on a computer for now.", url: "/chat?room=main&stage=1" });
    expect(stageNoticePush(`/chat?room=shortscout&thread=${stageNoticeId("shortscout", Math.floor(T0 / STAGE_NOTICE_SLOT_MS))}`, T0)).toMatchObject({ title: "SS is live now", url: "/chat?room=shortscout&stage=1" });
  });
  it("every other alert is left as it is", () => {
    for (const url of [
      "/chat?room=main&thread=0b0e7a52-8d0e-4d5e-9d39-0c1f7c1f2a11",
      `/chat?room=social&thread=${id}`, // another room's alert never borrows this id
      `/chat?room=nowhere&thread=${id}`,
      `/chat?dm=${id}`,
      "/chat?room=gainers",
      null,
      undefined,
    ])
      expect(stageNoticePush(url, T0), String(url)).toBeNull();
    // Long after the broadcast, the id means nothing.
    expect(stageNoticePush(`/chat?room=main&thread=${id}`, T0 + 8 * 60 * MIN)).toBeNull();
  });
});
