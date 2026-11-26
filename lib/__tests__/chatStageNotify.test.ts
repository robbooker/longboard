// #503: telling a room its live video is on, once. #524: the record of a broadcast is its row in
// chat_stage_broadcasts; the database here is a small stand-in that keeps the promises the real
// functions make (supabase/migrations/20261126120000_chat_stage_broadcasts.sql, checked against the
// real thing by scripts/tests/chat-stage-broadcasts-database.mjs): an id is created at most once, a
// room has one open broadcast at a time, a stale open one is closed when a new one opens, and bell
// entries are written a slice at a time with the place remembered. LiveKit is a list of ingresses.
//  - once only: a repeated webhook, two servers at the same moment, two servers either side of a
//    ten-minute line, a reconnect within 10 minutes; a later broadcast is announced again;
//  - #524: a broadcast longer than 6 hours is announced once; a missed end followed by a new
//    broadcast announces it and closes the stale notice; a brief drop never re-announces;
//  - the end: the message is rewritten and its alerts are taken back; a short drop changes nothing;
//  - #524 bells: written in slices; "message there, bells missing" is finished by the next look, once;
//  - the words: the room message, the bell's reading of it and the phone notification.
import { describe, expect, it } from "vitest";
import {
  STAGE_BELLS_RETRY_MS,
  STAGE_DROP_GRACE_MS,
  STAGE_NOTICE_SLOT_MS,
  STAGE_RECONNECT_MS,
  STAGE_SEEN_GAP_MS,
  stageBroadcastVerdict,
  stageNoticeId,
  stageNoticeIds,
  stageNoticePush,
  syncStageNotice,
  tellStageEnded,
  tellStageLive,
  writeStageBells,
  type StageBroadcast,
  type StageNoticeStore,
} from "@/lib/chatStageNotify";
import { composeStageEndedNotice, composeStageLiveNotice, stageEndedNotice, stageLiveNotice, stageLivePush, stageNoticeAuthor, STAGE_NOTICE_AUTHOR } from "@/lib/chatStageNotice";
import { isReservedChatName } from "@/lib/publicChat";
import type { ChatRoom } from "@/lib/publicChat";

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = Date.UTC(2026, 10, 25, 14, 30, 0) + 3 * MIN; // three minutes into a ten-minute slot
const ORIGIN = "https://chat.example.test";
const LIVE = "🔴 LB is live now. Watch live: https://chat.example.test/chat?room=main&stage=1";
const ENDED = "The live video in LB has ended. The recording will follow.";
const ENDED_BEFORE = "The live video in LB has ended.";
const RECORDING = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const ENDED_RECORDED = `The live video in LB has ended. Watch the recording: ${RECORDING}`;
const PAGE = 3;

type Row = StageBroadcast & { room: ChatRoom; body: string; cursor: number; bells: Set<string> };

/** The database as these rules see it. `tick` lets two callers interleave at every step. */
function fakeStore(members: string[] = ["acct-bob", "acct-cara"]) {
  const rows = new Map<string, Row>();
  const state = { clock: T0, opens: 0, seenWrites: 0, pages: 0, bellWrites: [] as string[], withdrawn: [] as string[], failPageAt: 0 };
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
  const copy = (row: Row | undefined): StageBroadcast | null => (row ? { ...row } : null);
  const store: StageNoticeStore = {
    latest: async (room) => {
      await tick();
      return copy([...rows.values()].filter((row) => row.room === room).sort((a, b) => b.createdAt - a.createdAt)[0]);
    },
    broadcast: async (id) => {
      await tick();
      return copy(rows.get(id));
    },
    open: async (id, room, body, startedAt, staleBody) => {
      await tick();
      state.opens++;
      if (rows.has(id)) return false;
      // Another server announced this room's broadcast within the last minute under another id: nothing is posted.
      if ([...rows.values()].some((row) => row.room === room && row.endedAt === null && state.clock - row.createdAt < 60_000)) return false;
      // One transaction: the stale open broadcast is closed, then the new one is written.
      for (const row of rows.values())
        if (row.room === room && row.endedAt === null) {
          row.endedAt = Math.max(row.lastLiveAt, row.startedAt);
          row.body = staleBody;
          row.bells.clear();
          state.withdrawn.push(row.id);
        }
      rows.set(id, { id, room, body, startedAt: Math.min(startedAt, state.clock), lastLiveAt: state.clock, endedAt: null, recordingUrl: null, recordingSource: null, notifiedAt: null, createdAt: state.clock, cursor: 0, bells: new Set() });
      return true;
    },
    seen: async (id, at, gap) => {
      const row = rows.get(id);
      if (row && row.endedAt === null && row.lastLiveAt < at - gap) {
        row.lastLiveAt = at;
        state.seenWrites++;
      }
    },
    close: async (_room, id, body, endedAt) => {
      await tick();
      const row = rows.get(id);
      if (!row || row.endedAt !== null) return false;
      row.endedAt = Math.min(Math.max(endedAt, row.startedAt), state.clock);
      row.body = body;
      row.bells.clear();
      state.withdrawn.push(id);
      return true;
    },
    reopen: async (_room, id, body) => {
      await tick();
      const row = rows.get(id);
      if (!row || row.endedAt === null) return false;
      row.endedAt = null;
      row.lastLiveAt = state.clock;
      row.body = body;
      return true;
    },
    notifyPage: async (id) => {
      await tick();
      state.pages++;
      if (state.failPageAt && state.pages === state.failPageAt) throw new Error("stage_notice_notify");
      const row = rows.get(id);
      if (!row || row.endedAt !== null || row.notifiedAt !== null) return { done: true };
      const slice = members.slice(row.cursor, row.cursor + PAGE);
      for (const account of slice) {
        if (!row.bells.has(account)) state.bellWrites.push(account);
        row.bells.add(account);
      }
      row.cursor += slice.length;
      if (slice.length < PAGE) row.notifiedAt = state.clock;
      return { done: slice.length < PAGE };
    },
  };
  const live = (room: ChatRoom, now: number, startedAt?: number | null) => {
    state.clock = now;
    return tellStageLive(store, room, { now, startedAt, origin: ORIGIN });
  };
  const end = (room: ChatRoom, now: number, endedAt = now) => {
    state.clock = now;
    return tellStageEnded(store, room, endedAt);
  };
  const told = () => [...rows.values()].filter((row) => row.notifiedAt !== null).length;
  return { store, rows, state, live, end, told, bodies: () => [...rows.values()].map((row) => row.body) };
}

describe("the words", () => {
  it("the room message names the room, never a person, and links to the stage", () => {
    expect(composeStageLiveNotice("LB", `${ORIGIN}/`, "main")).toBe(LIVE);
    expect(stageLiveNotice(LIVE)).toEqual({ before: "🔴 LB is live now. ", label: "Watch live", href: "/chat?room=main&stage=1", room: "main", roomName: "LB" });
    expect(stageLiveNotice(composeStageLiveNotice("Booker Stock Club", ORIGIN, "club"))).toMatchObject({ href: "/chat?room=club&stage=1", roomName: "Booker Stock Club" });
  });
  it("the ended message, an ordinary announcement and a look-alike are not live notices", () => {
    expect(composeStageEndedNotice("LB")).toBe(ENDED);
    expect(composeStageEndedNotice("LB", RECORDING)).toBe(ENDED_RECORDED);
    for (const body of [ENDED, ENDED_RECORDED, ENDED_BEFORE, "LB is live now.", `${LIVE} and more`, `Hello\n${LIVE}`, "🔴 LB is live now. Watch live: https://evil.test/elsewhere?room=main&stage=1", "🔴 LB is live now. Watch live: javascript:alert(1)"])
      expect(stageLiveNotice(body), body).toBeNull();
  });
  it("#504: the notice is shown as Live Video, live or ended; the bot's other posts keep their name", () => {
    expect(STAGE_NOTICE_AUTHOR).toBe("Live Video");
    expect(stageNoticeAuthor("longboard", LIVE)).toBe("Live Video");
    // Ended: as it reads now, with a recording, and as it read before #524 (those messages are still in the rooms).
    for (const body of [ENDED, ENDED_RECORDED, ENDED_BEFORE]) expect(stageNoticeAuthor("longboard", body), body).toBe("Live Video");
    expect(stageEndedNotice(ENDED)).toEqual({ roomName: "LB", recordingUrl: null });
    expect(stageEndedNotice(ENDED_BEFORE)).toEqual({ roomName: "LB", recordingUrl: null });
    expect(stageEndedNotice(ENDED_RECORDED)).toEqual({ roomName: "LB", recordingUrl: RECORDING });
    for (const body of [LIVE, "The live video in LB has ended. Watch the recording: http://plain.test/x", `${ENDED_RECORDED} more`, "The live video in LB has ended. The recording will follow. PS"])
      expect(stageEndedNotice(body), body).toBeNull();
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
    expect(stageLivePush("LB", "main")).toEqual({ title: "LB is live now", body: "Live video has started. Tap to watch.", url: "/chat?room=main&stage=1" });
  });
});

describe("once per broadcast", () => {
  it("a new broadcast: one message, and the room's members are told once", async () => {
    const db = fakeStore();
    expect(await db.live("main", T0, T0 - 2_000)).toBe("announced");
    expect(db.bodies()).toEqual([LIVE]);
    const [row] = db.rows.values();
    expect(row.id).toBe(stageNoticeId("main", Math.floor(T0 / STAGE_NOTICE_SLOT_MS)));
    expect([...row.bells]).toEqual(["acct-bob", "acct-cara"]);
    expect(row).toMatchObject({ startedAt: T0 - 2_000, endedAt: null, notifiedAt: T0 });
  });
  it("a repeated webhook, a retry and the admin's player all find the notice already there", async () => {
    const db = fakeStore();
    await db.live("main", T0, T0);
    for (const later of [50, 900, 30_000, 4 * MIN, 45 * MIN, 3 * HOUR]) expect(await db.live("main", T0 + later, T0)).toBe("already");
    expect(db.rows.size).toBe(1);
    // Nothing was even attempted again, and nobody's bell was written twice.
    expect(db.state.opens).toBe(1);
    expect(db.state.bellWrites).toEqual(["acct-bob", "acct-cara"]);
  });
  it("#524: a broadcast that runs longer than 6 hours is announced once, however rarely anyone looks", async () => {
    const db = fakeStore();
    await db.live("main", T0, T0);
    // A trading-desk day: looked at every few minutes, then not at all for five hours, then again.
    for (const later of [5 * MIN, 20 * MIN, 6 * HOUR - MIN, 6 * HOUR + MIN, 7 * HOUR, 12 * HOUR, 26 * HOUR])
      expect(await db.live("main", T0 + later, T0), `${later / HOUR} h`).toBe("already");
    expect(db.rows.size).toBe(1);
    expect(db.bodies()).toEqual([LIVE]);
    expect(db.state.bellWrites).toHaveLength(2);
    // And it still ends as one broadcast.
    expect(await db.end("main", T0 + 27 * HOUR)).toBe(true);
    expect(db.bodies()).toEqual([ENDED]);
  });
  it("#524: while it is live, \"last seen live\" is written at most once a minute", async () => {
    const db = fakeStore();
    await db.live("main", T0, T0);
    for (let second = 1; second <= 300; second += 5) await db.live("main", T0 + second * 1_000, T0);
    expect(db.state.seenWrites).toBeLessThanOrEqual(5);
    expect(db.state.seenWrites).toBeGreaterThanOrEqual(4);
    expect(STAGE_SEEN_GAP_MS).toBe(60_000);
  });
  it("two servers at the same moment: both try the same id, one creates it, one notifies", async () => {
    const db = fakeStore();
    const results = await Promise.all(Array.from({ length: 6 }, () => db.live("main", T0, T0 - 1_000)));
    expect(results.filter((result) => result === "announced")).toHaveLength(1);
    expect(results.filter((result) => result === "already")).toHaveLength(5);
    expect(db.state.opens).toBe(6); // all six really raced: each read "no broadcast" before any insert
    expect(db.rows.size).toBe(1);
    expect(db.state.bellWrites).toEqual(["acct-bob", "acct-cara"]);
  });
  it("two servers either side of a ten-minute line still agree, because the id comes from LiveKit's start time", async () => {
    const db = fakeStore();
    const line = Math.ceil(T0 / STAGE_NOTICE_SLOT_MS) * STAGE_NOTICE_SLOT_MS;
    const startedAt = line - 400;
    const results = await Promise.all([db.live("main", line - 20, startedAt), db.live("main", line + 20, startedAt), db.live("main", line + 900, startedAt)]);
    expect(results.filter((result) => result === "announced")).toHaveLength(1);
    expect(db.rows.size).toBe(1);
    expect(db.state.bellWrites).toHaveLength(2);
  });
  it("without a start time from LiveKit the server's clock picks the slot, and two calls in it still make one notice", async () => {
    const db = fakeStore();
    const results = await Promise.all([db.live("main", T0, null), db.live("main", T0 + 40, undefined)]);
    expect(results.sort()).toEqual(["already", "announced"]);
    expect(db.rows.size).toBe(1);
  });
  it("the database refusing a second open broadcast (another server, another id) announces nothing twice", async () => {
    const db = fakeStore();
    await db.live("main", T0, T0);
    const open = db.store.open;
    // What the real store answers when the room's one-open-broadcast rule stops the insert.
    db.store.open = async () => false;
    db.store.latest = async () => null;
    db.store.broadcast = async () => null;
    expect(await db.live("main", T0 + 15 * MIN, T0 + 15 * MIN)).toBe("already");
    db.store.open = open;
    expect(db.rows.size).toBe(1);
  });
  it("#524: without a start time, two servers either side of a ten-minute line ask for different ids and still make one notice", async () => {
    const db = fakeStore();
    const line = Math.ceil(T0 / STAGE_NOTICE_SLOT_MS) * STAGE_NOTICE_SLOT_MS;
    // The second read "no broadcast" before the first one's was written (a stale answer), then asks for its own slot's id.
    const latest = db.store.latest;
    expect(await db.live("main", line - 50, null)).toBe("announced");
    db.store.latest = async () => null;
    expect(await db.live("main", line + 50, null)).toBe("already");
    db.store.latest = latest;
    expect(db.rows.size).toBe(1);
    expect(db.bodies()).toEqual([LIVE]);
    expect(db.state.bellWrites).toHaveLength(2);
  });
  it("rooms are separate: each is told about its own broadcast", async () => {
    const db = fakeStore();
    expect(await db.live("main", T0, T0)).toBe("announced");
    expect(await db.live("club", T0, T0)).toBe("announced");
    expect([...db.rows.values()].map((row) => row.room)).toEqual(["main", "club"]);
    expect(db.bodies()[1]).toBe("🔴 Booker Stock Club is live now. Watch live: https://chat.example.test/chat?room=club&stage=1");
    expect(stageNoticeIds("main", T0).some((id) => stageNoticeIds("club", T0).includes(id))).toBe(false);
  });
  it("a refused post (a paused room) notifies nobody", async () => {
    const db = fakeStore();
    db.store.open = async () => {
      throw new Error("stage_notice_post");
    };
    await expect(db.live("main", T0, T0)).rejects.toThrow("stage_notice_post");
    expect(db.state.bellWrites).toEqual([]);
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
    expect(db.rows.get(id)!.bells.size).toBe(0);
    // A second end signal (ingress_ended, room_finished, a status read) finds nothing live.
    expect(await db.end("main", T0 + 50 * MIN + 500)).toBe(false);
    expect(await Promise.all([db.end("main", T0 + 51 * MIN), db.end("main", T0 + 51 * MIN)])).toEqual([false, false]);
    expect(db.state.withdrawn).toEqual([id]);
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
    expect((await Promise.all([db.live("main", back, back - 500), db.live("main", back + 30, back - 500)])).sort()).toEqual(["already", "resumed"]);
    expect(db.bodies()).toEqual([LIVE]);
    expect(db.rows.size).toBe(1);
    expect(db.state.bellWrites).toHaveLength(2);
    expect(await db.live("main", back + 5_000, back - 500)).toBe("already");
    // And it can end again.
    expect(await db.end("main", back + 30 * MIN)).toBe(true);
    expect(db.bodies()).toEqual([ENDED]);
  });
  it("#524: a reconnect looked at late is still the same broadcast (it began soon after the end)", async () => {
    const db = fakeStore();
    await db.live("main", T0, T0);
    await db.end("main", T0 + 20 * MIN);
    // Back 4 minutes after the end; the first look at it comes 40 minutes later.
    expect(await db.live("main", T0 + 64 * MIN, T0 + 24 * MIN)).toBe("resumed");
    expect(db.rows.size).toBe(1);
  });
  it("a new broadcast later (10 minutes or more after the end) is announced again, in its own message", async () => {
    const db = fakeStore();
    await db.live("main", T0, T0);
    await db.end("main", T0 + 30 * MIN);
    // (Begun, by LiveKit's time, a full 10 minutes after the end.)
    const next = T0 + 30 * MIN + STAGE_RECONNECT_MS + 800;
    expect(await Promise.all([db.live("main", next, next - 800), db.live("main", next + 10, next - 800)])).toEqual(expect.arrayContaining(["announced", "already"]));
    expect(db.bodies()).toEqual([ENDED, LIVE]);
    expect(db.told()).toBe(2);
    // The next day too.
    await db.end("main", next + 60 * MIN);
    expect(await db.live("main", next + 24 * HOUR, next + 24 * HOUR)).toBe("announced");
    expect(db.rows.size).toBe(3);
  });
  it("a start time that belongs to an earlier, finished broadcast does not hide a new one", async () => {
    const db = fakeStore();
    await db.live("main", T0, T0);
    await db.end("main", T0 + 2 * MIN);
    // LiveKit still reports the first start time, 40 minutes on: the clock's slot is used instead.
    expect(await db.live("main", T0 + 40 * MIN, T0)).toBe("announced");
    expect(db.rows.size).toBe(2);
    expect(await db.live("main", T0 + 40 * MIN + 100, T0)).toBe("already");
  });
  it("#524: a missed end, then a new broadcast: it is announced, and the stale notice is marked ended at that moment", async () => {
    const db = fakeStore();
    await db.live("main", T0, T0);
    const [stale] = db.rows.keys();
    await db.live("main", T0 + 50 * MIN, T0); // last seen live 50 minutes in
    // It stopped at about the hour. No webhook arrived and nobody had the room open: the notice still says live.
    // Ninety minutes later a new broadcast starts (well inside the old 6 hours).
    const next = T0 + 150 * MIN;
    expect(await db.live("main", next + 2_000, next)).toBe("announced");
    expect(db.bodies()).toEqual([ENDED, LIVE]);
    expect(db.state.withdrawn).toEqual([stale]);
    // The stale one is recorded as over since it was last seen live.
    expect(db.rows.get(stale)).toMatchObject({ endedAt: T0 + 50 * MIN });
    expect(db.rows.get(stale)!.bells.size).toBe(0); // its bells were taken back; the new one's are written
    expect(db.state.bellWrites).toHaveLength(4);
    // Every later look agrees.
    expect(await db.live("main", next + 5 * MIN, next)).toBe("already");
    expect(db.rows.size).toBe(2);
  });
  it("#524: the same missed end found late by a look, then a new broadcast minutes after that look: still announced", async () => {
    const db = fakeStore();
    await db.live("main", T0, T0);
    await db.live("main", T0 + 50 * MIN, T0);
    // Someone opens the room two hours later: the look marks it ended, as of when it was last seen live.
    expect(await db.end("main", T0 + 170 * MIN, T0 + 50 * MIN)).toBe(true);
    // A new broadcast three minutes after that look is not mistaken for the old one coming back.
    const next = T0 + 173 * MIN;
    expect(await db.live("main", next + 1_000, next)).toBe("announced");
    expect(db.bodies()).toEqual([ENDED, LIVE]);
  });
  it("#524: a brief drop nobody marked does not re-announce: what is on now began within 10 minutes of the last sight", () => {
    const row: StageBroadcast = { id: "x", startedAt: T0, lastLiveAt: T0 + 50 * MIN, endedAt: null, recordingUrl: null, recordingSource: null, notifiedAt: T0, createdAt: T0 };
    const verdict = (startedAt: number | null, now = T0 + 3 * HOUR) => stageBroadcastVerdict(row, { now, startedAt });
    expect(verdict(T0)).toBe("same"); // the very session that was announced
    expect(verdict(T0 + 52 * MIN)).toBe("same"); // dropped and reconnected two minutes after the last sight
    expect(verdict(T0 + 50 * MIN + STAGE_RECONNECT_MS - 1)).toBe("same");
    expect(verdict(T0 + 50 * MIN + STAGE_RECONNECT_MS)).toBe("new");
    // No start time from LiveKit: the clock, with the old six hours.
    expect(verdict(null, T0 + 5 * HOUR)).toBe("same");
    expect(verdict(null, T0 + 7 * HOUR)).toBe("new");
    // An ended one: back within 10 minutes by the clock, or by LiveKit's start time when looked at late.
    const ended = { ...row, endedAt: T0 + 60 * MIN };
    expect(stageBroadcastVerdict(ended, { now: T0 + 65 * MIN, startedAt: null })).toBe("resume");
    expect(stageBroadcastVerdict(ended, { now: T0 + 2 * HOUR, startedAt: T0 + 64 * MIN })).toBe("resume");
    expect(stageBroadcastVerdict(ended, { now: T0 + 2 * HOUR, startedAt: T0 + 71 * MIN })).toBe("new");
    // LiveKit still giving the start time already announced says nothing about a return.
    expect(stageBroadcastVerdict(ended, { now: T0 + 2 * HOUR, startedAt: T0 })).toBe("new");
  });
});

describe("#524 bell entries: slices, and \"message there, bells missing\"", () => {
  const many = Array.from({ length: 10 }, (_, i) => `acct-${i + 1}`);
  it("a large room is covered a slice at a time, each account once", async () => {
    const db = fakeStore(many);
    expect(await db.live("main", T0, T0)).toBe("announced");
    expect(db.state.pages).toBe(4); // 3 + 3 + 3 + 1
    expect(db.state.bellWrites).toEqual(many);
    expect([...db.rows.values()][0].notifiedAt).toBe(T0);
  });
  it("cut off after the message was posted: the next look finishes the bells, from where they stopped, exactly once", async () => {
    const db = fakeStore(many);
    db.state.failPageAt = 2; // the announcing call dies on its second slice (a timeout)
    await expect(db.live("main", T0, T0)).rejects.toThrow("stage_notice_notify");
    const [row] = db.rows.values();
    expect(db.bodies()).toEqual([LIVE]);
    expect(row.notifiedAt).toBeNull();
    expect(db.state.bellWrites).toEqual(many.slice(0, 3));
    // A look a few seconds later (a second webhook) leaves it: the first call may still be at work.
    expect(await db.live("main", T0 + 5_000, T0)).toBe("already");
    expect(db.state.bellWrites).toHaveLength(3);
    // The next look after that finishes the job: only the members not yet told.
    expect(await db.live("main", T0 + STAGE_BELLS_RETRY_MS, T0)).toBe("already");
    expect(db.state.bellWrites).toEqual(many);
    expect(row.notifiedAt).toBe(T0 + STAGE_BELLS_RETRY_MS);
    expect(db.rows.size).toBe(1);
    // And never again.
    const pages = db.state.pages;
    expect(await db.live("main", T0 + 5 * MIN, T0)).toBe("already");
    expect(db.state.pages).toBe(pages);
    expect(db.state.bellWrites).toEqual(many);
  });
  it("cut off before any bell was written: all of them are written by the next look", async () => {
    const db = fakeStore(many);
    db.state.failPageAt = 1;
    await expect(db.live("main", T0, T0)).rejects.toThrow();
    expect(db.state.bellWrites).toEqual([]);
    await db.live("main", T0 + MIN, T0);
    expect(db.state.bellWrites).toEqual(many);
  });
  it("two looks finishing at once still write each bell once", async () => {
    const db = fakeStore(many);
    db.state.failPageAt = 1;
    await expect(db.live("main", T0, T0)).rejects.toThrow();
    await Promise.all([db.live("main", T0 + MIN, T0), db.live("main", T0 + MIN, T0), db.live("main", T0 + MIN, T0)]);
    expect(db.state.bellWrites).toEqual(many);
  });
  it("a broadcast that ended meanwhile is not told about late", async () => {
    const db = fakeStore(many);
    db.state.failPageAt = 1;
    await expect(db.live("main", T0, T0)).rejects.toThrow();
    await db.end("main", T0 + 30_000);
    const [row] = db.rows.values();
    expect(await writeStageBells(db.store, row.id, "main")).toBe(true);
    expect(db.state.bellWrites).toEqual([]);
  });
  it("gives up after its limit of slices rather than looping, and says so", async () => {
    let calls = 0;
    expect(await writeStageBells({ notifyPage: async () => (calls++, { done: false }) }, "x", "main")).toBe(false);
    expect(calls).toBe(400);
  });
});

describe("following LiveKit (syncStageNotice)", () => {
  type Ingress = { publishing: boolean; startedAt?: number; activeAt?: number };
  function setup(first: Ingress[]) {
    const db = fakeStore();
    const lk = { ingresses: first, reads: 0, waits: [] as number[], afterWait: null as Ingress[] | null, now: T0, stoppedFor: undefined as number | null | undefined, timely: false };
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
          stoppedFor: () => lk.stoppedFor ?? null,
          timely: lk.timely,
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
    expect(db.told()).toBe(1);
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
    expect(db.state.bellWrites).toHaveLength(2);
  });
  it("#524: a short drop hours into a broadcast nobody had looked at for a while does not re-announce", async () => {
    // Announced at T0 and not looked at again. Four hours in, StreamYard drops for a few seconds:
    // LiveKit's webhook brings a look, which finds it back (as a new session) within the grace.
    const { db, lk, sync } = setup([{ publishing: true, startedAt: T0 }]);
    await sync();
    lk.timely = true;
    lk.now = T0 + 4 * HOUR;
    lk.ingresses = [{ publishing: false, activeAt: T0 + 4 * HOUR - 2_000 }];
    lk.afterWait = [{ publishing: true, startedAt: T0 + 4 * HOUR + 6_000 }];
    expect(await sync()).toBe("already");
    expect(db.rows.size).toBe(1);
    expect(db.bodies()).toEqual([LIVE]);
    // The same if that look is lost during its wait and the next one comes minutes later.
    const lost = setup([{ publishing: true, startedAt: T0 }]);
    await lost.sync();
    lost.lk.timely = true;
    lost.lk.now = T0 + 4 * HOUR;
    lost.lk.ingresses = [{ publishing: false }];
    const waiting = syncStageNotice(
      { store: lost.db.store, ingresses: async () => lost.lk.ingresses, wait: () => new Promise(() => undefined), now: () => ((lost.db.state.clock = lost.lk.now), lost.lk.now), origin: ORIGIN, timely: true },
      "main",
    );
    void waiting; // never comes back: the function was recycled
    await new Promise((resolve) => setTimeout(resolve, 20));
    lost.lk.now = T0 + 4 * HOUR + 5 * MIN;
    lost.lk.ingresses = [{ publishing: true, startedAt: T0 + 4 * HOUR + 40_000 }];
    expect(await lost.sync()).toBe("already");
    expect(lost.db.rows.size).toBe(1);
  });
  it("#521: waits only the rest of the grace when it is known how long the broadcast has been stopped", async () => {
    // Stopped 8 seconds ago: 12 more, then looked at again. It came back: nothing changes.
    const back = setup([{ publishing: true, startedAt: T0 }]);
    await back.sync();
    back.lk.ingresses = [{ publishing: false }];
    back.lk.afterWait = [{ publishing: true, startedAt: T0 + 9_000 }];
    back.lk.stoppedFor = 8_000;
    back.lk.now = T0 + 10_000;
    expect(await back.sync()).toBe("already");
    expect(back.lk.waits).toEqual([STAGE_DROP_GRACE_MS - 8_000]);
    // Stopped for longer than the grace already (a look that was lost and is run again): no wait
    // and no second LiveKit read; the message says it ended at once.
    for (const stoppedFor of [STAGE_DROP_GRACE_MS, 10 * MIN]) {
      const lost = setup([{ publishing: true, startedAt: T0 }]);
      await lost.sync();
      lost.lk.ingresses = [{ publishing: false }];
      lost.lk.stoppedFor = stoppedFor;
      lost.lk.now = T0 + 30 * MIN;
      const reads = lost.lk.reads;
      expect(await lost.sync()).toBe("ended");
      expect(lost.lk.waits).toEqual([]);
      expect(lost.lk.reads).toBe(reads + 1);
      expect(lost.db.bodies()).toEqual([ENDED]);
      // Recorded as over since this server saw it stop.
      expect([...lost.db.rows.values()][0].endedAt).toBe(T0 + 30 * MIN - stoppedFor);
    }
    // Not known, or nonsense: the whole grace, as before.
    for (const stoppedFor of [null, -5_000, 0]) {
      const unknown = setup([{ publishing: true, startedAt: T0 }]);
      await unknown.sync();
      unknown.lk.ingresses = [{ publishing: false }];
      unknown.lk.stoppedFor = stoppedFor;
      expect(await unknown.sync()).toBe("ended");
      expect(unknown.lk.waits).toEqual([STAGE_DROP_GRACE_MS]);
    }
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
  it("#524: when it stopped is recorded as well as it is known", async () => {
    const at = async (change: (lk: ReturnType<typeof setup>["lk"]) => void) => {
      const { db, lk, sync } = setup([{ publishing: true, startedAt: T0 }]);
      await sync();
      lk.now = T0 + 10 * MIN;
      await sync(); // last seen live ten minutes in
      lk.ingresses = [{ publishing: false }];
      lk.now = T0 + 2 * HOUR;
      change(lk);
      expect(await sync()).toBe("ended");
      return [...db.rows.values()][0].endedAt;
    };
    // LiveKit's webhook (or an admin's action) says so now.
    expect(await at((lk) => (lk.timely = true))).toBe(T0 + 2 * HOUR);
    // LiveKit says when the ingress was last active.
    expect(await at((lk) => (lk.ingresses = [{ publishing: false, activeAt: T0 + 55 * MIN }]))).toBe(T0 + 55 * MIN);
    // Nothing known (a status read long after, on a server that never saw it live): since it was last seen live.
    expect(await at(() => undefined)).toBe(T0 + 10 * MIN);
  });
  it("#512: one permanent ingress, no End button: each broadcast is announced, and ended when it stops publishing", async () => {
    // The room's ingress exists before, between and after broadcasts: the state is never "off".
    const { db, lk, sync } = setup([{ publishing: false }]);
    lk.timely = true;
    expect(await sync()).toBe("none");
    // StreamYard goes live.
    lk.ingresses = [{ publishing: true, startedAt: T0 }];
    expect(await sync()).toBe("announced");
    const [first] = db.rows.keys();
    // StreamYard stops. The ingress stays; nothing else says "end". Three hints at once (LiveKit's
    // webhook, an admin's player, a member's status read): one rewrite, the alerts taken back once.
    lk.ingresses = [{ publishing: false, startedAt: T0 }];
    lk.now = T0 + 40 * MIN;
    expect((await Promise.all([sync(), sync(), sync()])).sort()).toEqual(["ended", "none", "none"]);
    expect(lk.waits).toEqual([STAGE_DROP_GRACE_MS, STAGE_DROP_GRACE_MS, STAGE_DROP_GRACE_MS]);
    expect(db.bodies()).toEqual([ENDED]);
    expect(db.state.withdrawn).toEqual([first]);
    // Later hints while it rests at "waiting" do nothing and wait for nothing.
    lk.waits.length = 0;
    lk.now = T0 + 45 * MIN;
    expect(await sync()).toBe("none");
    expect(lk.waits).toEqual([]);
    // Back five minutes after the end: the same broadcast, the same message, nobody told again.
    lk.ingresses = [{ publishing: true, startedAt: T0 + 45 * MIN }];
    expect(await sync()).toBe("resumed");
    expect(db.bodies()).toEqual([LIVE]);
    expect(db.state.bellWrites).toHaveLength(2);
    lk.ingresses = [{ publishing: false }];
    lk.now = T0 + 60 * MIN;
    expect(await sync()).toBe("ended");
    // The next broadcast on the same ingress, the same afternoon: its own message, everyone told.
    lk.ingresses = [{ publishing: true, startedAt: T0 + 120 * MIN }];
    lk.now = T0 + 120 * MIN + 2_000;
    expect(await sync()).toBe("announced");
    expect(db.bodies()).toEqual([ENDED, LIVE]);
    expect(db.state.bellWrites).toHaveLength(4);
    expect([...db.rows.keys()][1]).not.toBe(first);
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
    // #524: even a broadcast that starts two minutes after that look is a new one.
    lk.ingresses = [{ publishing: true, startedAt: T0 + 122 * MIN }];
    lk.now = T0 + 122 * MIN + 3_000;
    expect(await sync()).toBe("announced");
    expect(db.rows.size).toBe(2);
  });
  it("#524: an end nobody signalled and nobody looked at: the next broadcast's own start announces it and ends the stale notice", async () => {
    const { db, lk, sync } = setup([{ publishing: true, startedAt: T0 }]);
    await sync();
    lk.timely = true;
    lk.ingresses = [{ publishing: true, startedAt: T0 + 3 * HOUR }];
    lk.now = T0 + 3 * HOUR + 1_500;
    expect(await sync()).toBe("announced");
    expect(db.bodies()).toEqual([ENDED, LIVE]);
  });
  it("a LiveKit outage changes nothing", async () => {
    const { db, sync } = setup([{ publishing: true, startedAt: T0 }]);
    await sync();
    const failing = syncStageNotice({ store: db.store, ingresses: async () => Promise.reject(new Error("down")), wait: async () => undefined, now: () => T0, origin: ORIGIN }, "main");
    await expect(failing).rejects.toThrow("down");
    expect(db.bodies()).toEqual([LIVE]);
  });
});

describe("the phone notification (stageNoticePush)", () => {
  const id = stageNoticeId("main", Math.floor(T0 / STAGE_NOTICE_SLOT_MS));
  it("a live notice's alert says the room is live and opens the stage link", () => {
    expect(stageNoticePush(`/chat?room=main&thread=${id}`, T0 + 2 * MIN)).toEqual({ title: "LB is live now", body: "Live video has started. Tap to watch.", url: "/chat?room=main&stage=1" });
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
