// #524: the recording on an ended live-video notice. The pure rules (which link, which broadcast,
// the player card) and the attach itself with the database faked.
//  - a YouTube or Loom link posted in LB Recordings goes onto LB's last ended broadcast, SS
//    Recordings onto SS's; no other room is guessed at;
//  - only within the window, only after the broadcast began, only once it has ended;
//  - the first link wins; an admin's link (or an admin removing it) is never overwritten by a post;
//  - only Longboard Bot's ended notice gets a player card in an ordinary room.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ publish: vi.fn(), after: vi.fn(), db: null as unknown }));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: mocks.after }));
vi.mock("@/lib/chatRealtimePublish", () => ({ publishRoomEvent: mocks.publish, publishRoomEventAfterResponse: vi.fn() }));
vi.mock("@/lib/chatAdmin", () => ({ createChatAdminClient: () => mocks.db }));
import { recordingVideosFromText } from "@/lib/chatRecordingVideos";
import { STAGE_RECORDING_WINDOW_MS, stageRecordingFits, stageRecordingFromPost, stageRecordingUrl, stageRecordingVideos } from "@/lib/chatStageRecording";
import { attachStageRecordingFromPost, stageRecordingAfterPost } from "@/lib/chatStageRecordingServer";
import { composeStageEndedNotice } from "@/lib/chatStageNotice";
import type { ChatRoom } from "@/lib/publicChat";

const HOUR = 60 * 60_000;
const T0 = Date.UTC(2026, 10, 25, 19, 0, 0);
const YT = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const LOOM = "https://www.loom.com/share/0123456789abcdef0123456789abcdef";

describe("the link", () => {
  it("is rebuilt from the video id: nothing else of what was pasted is kept", () => {
    expect(stageRecordingUrl("https://youtu.be/dQw4w9WgXcQ?si=abc&feature=share")).toBe(YT);
    expect(stageRecordingUrl("https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=PLx&t=1m30s")).toBe(`${YT}&t=90s`);
    expect(stageRecordingUrl("https://www.youtube.com/live/dQw4w9WgXcQ")).toBe(YT);
    expect(stageRecordingUrl("https://www.loom.com/embed/0123456789abcdef0123456789abcdef?autoplay=1")).toBe(LOOM);
    // What it makes passes its own check and stays the same.
    for (const url of [YT, `${YT}&t=90s`, LOOM]) expect(stageRecordingUrl(url)).toBe(url);
  });
  it("is null for anything else", () => {
    for (const value of [null, undefined, 5, "", "watch this", "https://vimeo.com/1", "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/watch?v=short", "https://user:pw@youtu.be/dQw4w9WgXcQ", `https://youtu.be/dQw4w9WgXcQ?x=${"a".repeat(600)}`])
      expect(stageRecordingUrl(value), String(value)).toBeNull();
  });
});

describe("a post in a recordings room", () => {
  it("LB Recordings is LB's, SS Recordings is SS's; the first video link in the post is taken", () => {
    expect(stageRecordingFromPost("lb-recordings", `11/25/26 | LONGBOARD WEBINAR: https://youtu.be/dQw4w9WgXcQ`)).toEqual({ room: "main", url: YT });
    expect(stageRecordingFromPost("ss-recordings", `Tonight's session ${LOOM}?sid=1 and slides https://example.test/slides`)).toEqual({ room: "shortscout", url: LOOM });
    expect(stageRecordingFromPost("lb-recordings", `Slides https://example.test/a then ${LOOM} then https://youtu.be/dQw4w9WgXcQ`)).toEqual({ room: "main", url: LOOM });
  });
  it("no other room is guessed at, and a post without a video link is nothing", () => {
    for (const room of ["main", "shortscout", "social", "club", "lb-announcements", "ss-announcements", "whats-new", "gainers", "developers"] as ChatRoom[])
      expect(stageRecordingFromPost(room, `Recording: ${YT}`), room).toBeNull();
    for (const body of ["The recording is coming.", "https://example.test/youtube", "see youtu.be soon", "https://www.youtube.com/playlist?list=PL1"])
      expect(stageRecordingFromPost("lb-recordings", body), body).toBeNull();
  });
});

describe("which broadcast it belongs to", () => {
  const ended = { startedAt: T0, endedAt: T0 + HOUR, recordingUrl: null, recordingSource: null };
  it("the room's last broadcast, once ended, within 36 hours of its start", () => {
    expect(STAGE_RECORDING_WINDOW_MS).toBe(36 * HOUR);
    expect(stageRecordingFits(ended, T0 + HOUR + 60_000)).toBe(true); // posted right after
    expect(stageRecordingFits(ended, T0 + 15 * HOUR)).toBe(true); // the next morning
    expect(stageRecordingFits(ended, T0 + 36 * HOUR)).toBe(true);
    expect(stageRecordingFits(ended, T0 + 36 * HOUR + 1)).toBe(false); // two days on: not guessed
  });
  it("not a post from before the broadcast began, not while it is still live, not when there is none", () => {
    expect(stageRecordingFits(ended, T0 - 1)).toBe(false);
    expect(stageRecordingFits({ ...ended, endedAt: null }, T0 + 30 * 60_000)).toBe(false);
    expect(stageRecordingFits(null, T0)).toBe(false);
  });
  it("the first link wins, and an admin's choice stands (a link, or having removed one)", () => {
    expect(stageRecordingFits({ ...ended, recordingUrl: YT, recordingSource: "post" }, T0 + 2 * HOUR)).toBe(false);
    expect(stageRecordingFits({ ...ended, recordingUrl: LOOM, recordingSource: "admin" }, T0 + 2 * HOUR)).toBe(false);
    expect(stageRecordingFits({ ...ended, recordingUrl: null, recordingSource: "admin" }, T0 + 2 * HOUR)).toBe(false);
  });
});

describe("attaching it", () => {
  type Row = { notice_id: string; room_slug: string; started_at: string; last_live_at: string; ended_at: string | null; recording_url: string | null; recording_source: string | null; notified_at: string | null; created_at: string };
  const iso = (ms: number) => new Date(ms).toISOString();
  function database(rows: Row[]) {
    const calls: Record<string, unknown>[] = [];
    const db = {
      from: () => {
        let room = "";
        const query = {
          select: () => query,
          eq: (_column: string, value: string) => ((room = value), query),
          order: () => query,
          limit: async () => ({ data: rows.filter((row) => row.room_slug === room).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 1), error: null }),
        };
        return query;
      },
      // What the real function does with p_only_if_empty (the database test checks the real one).
      rpc: async (_name: string, args: { p_id: string; p_room: string; p_url: string | null; p_source: string; p_only_if_empty: boolean }) => {
        calls.push(args);
        const row = rows.find((known) => known.notice_id === args.p_id && known.room_slug === args.p_room && known.ended_at !== null);
        if (!row || (args.p_only_if_empty && (row.recording_url || row.recording_source))) return { data: false, error: null };
        row.recording_url = args.p_url;
        row.recording_source = args.p_source;
        return { data: true, error: null };
      },
    };
    return { db: db as never, calls };
  }
  const row = (over: Partial<Row> = {}): Row => ({ notice_id: "n1", room_slug: "main", started_at: iso(T0), last_live_at: iso(T0 + HOUR), ended_at: iso(T0 + HOUR), recording_url: null, recording_source: null, notified_at: iso(T0), created_at: iso(T0), ...over });
  beforeEach(() => vi.clearAllMocks());

  it("a link posted in LB Recordings goes onto LB's ended notice, which is rewritten; the room reloads; nobody is notified", async () => {
    const rows = [row()];
    const { db, calls } = database(rows);
    expect(await attachStageRecordingFromPost(db, "lb-recordings", "11/25/26 | LONGBOARD WEBINAR https://youtu.be/dQw4w9WgXcQ", T0 + 2 * HOUR)).toBe(true);
    expect(calls).toEqual([{ p_id: "n1", p_room: "main", p_url: YT, p_body: composeStageEndedNotice("LB", YT), p_source: "post", p_only_if_empty: true }]);
    expect(rows[0]).toMatchObject({ recording_url: YT, recording_source: "post" });
    expect(mocks.publish.mock.calls).toEqual([["main", { kind: "changed", topics: ["history"] }]]);
  });
  it("a second link does not replace the first", async () => {
    const rows = [row()];
    const { db, calls } = database(rows);
    await attachStageRecordingFromPost(db, "lb-recordings", `Part one ${YT}`, T0 + 2 * HOUR);
    expect(await attachStageRecordingFromPost(db, "lb-recordings", `Part two ${LOOM}`, T0 + 3 * HOUR)).toBe(false);
    expect(rows[0].recording_url).toBe(YT);
    expect(calls).toHaveLength(1);
    // Two posts at the same moment: both ask, the database lets one through.
    const race = database([row()]);
    const results = await Promise.all([attachStageRecordingFromPost(race.db, "lb-recordings", YT, T0 + 2 * HOUR), attachStageRecordingFromPost(race.db, "lb-recordings", LOOM, T0 + 2 * HOUR)]);
    expect(results.sort()).toEqual([false, true]);
  });
  it("the wrong room's recordings room is ignored: an SS recording never lands on LB's notice", async () => {
    const rows = [row()];
    const { db, calls } = database(rows);
    expect(await attachStageRecordingFromPost(db, "ss-recordings", `SS session ${YT}`, T0 + 2 * HOUR)).toBe(false);
    expect(await attachStageRecordingFromPost(db, "social", `LB session ${YT}`, T0 + 2 * HOUR)).toBe(false);
    expect(await attachStageRecordingFromPost(db, "lb-announcements", `LB session ${YT}`, T0 + 2 * HOUR)).toBe(false);
    expect(calls).toEqual([]);
    expect(rows[0].recording_url).toBeNull();
  });
  it("#537: a link posted in Recordings > Booker Stock Club goes onto the Webinars room's ended notice; its copies' rooms reload too", async () => {
    const rows = [row({ notice_id: "w1", room_slug: "webinars" }), row()];
    const { db, calls } = database(rows);
    expect(stageRecordingFromPost("club-recordings", `Tuesday's webinar ${YT}`)).toEqual({ room: "webinars", url: YT });
    expect(await attachStageRecordingFromPost(db, "club-recordings", `Tuesday's webinar ${YT}`, T0 + 2 * HOUR)).toBe(true);
    expect(calls).toEqual([{ p_id: "w1", p_room: "webinars", p_url: YT, p_body: composeStageEndedNotice("Webinars", YT), p_source: "post", p_only_if_empty: true }]);
    expect(rows[0]).toMatchObject({ recording_url: YT, recording_source: "post" });
    expect(rows[1].recording_url).toBeNull(); // LB's notice is LB Recordings' business
    // Webinars reloads, and so does every room that holds a copy of its notice (the database rewrote them).
    const reloaded = mocks.publish.mock.calls.map((call) => call[0]);
    expect(reloaded[0]).toBe("webinars");
    for (const room of ["social", "club", "club-recordings", "lb-recordings", "whats-new"]) expect(reloaded).toContain(room);
    for (const room of ["admins", "gainers"]) expect(reloaded).not.toContain(room);
  });
  it("#537: the same recordings room holds Booker Stock Club's own webinars: the link goes onto whichever fitting broadcast started last", async () => {
    // Only the club had a webinar.
    const club = database([row({ notice_id: "c1", room_slug: "club" })]);
    expect(await attachStageRecordingFromPost(club.db, "club-recordings", YT, T0 + 2 * HOUR)).toBe(true);
    expect(club.calls[0]).toMatchObject({ p_id: "c1", p_room: "club", p_body: composeStageEndedNotice("Booker Stock Club", YT) });
    // Both did: the later one takes the first link, the earlier one the next.
    const rows = [row({ notice_id: "w1", room_slug: "webinars" }), row({ notice_id: "c1", room_slug: "club", started_at: iso(T0 + 3 * HOUR), last_live_at: iso(T0 + 4 * HOUR), ended_at: iso(T0 + 4 * HOUR), created_at: iso(T0 + 3 * HOUR) })];
    const both = database(rows);
    expect(await attachStageRecordingFromPost(both.db, "club-recordings", YT, T0 + 5 * HOUR)).toBe(true);
    expect(both.calls[0]).toMatchObject({ p_id: "c1", p_room: "club" });
    expect(await attachStageRecordingFromPost(both.db, "club-recordings", LOOM, T0 + 6 * HOUR)).toBe(true);
    expect(both.calls[1]).toMatchObject({ p_id: "w1", p_room: "webinars", p_url: LOOM });
    // A webinar still live, or with its recording already set, is passed over; LB Recordings never reaches Webinars.
    const live = database([row({ notice_id: "w2", room_slug: "webinars", ended_at: null })]);
    expect(await attachStageRecordingFromPost(live.db, "club-recordings", YT, T0 + 2 * HOUR)).toBe(false);
    const other = database([row({ notice_id: "w3", room_slug: "webinars" })]);
    expect(await attachStageRecordingFromPost(other.db, "lb-recordings", YT, T0 + 2 * HOUR)).toBe(false);
    expect(await attachStageRecordingFromPost(other.db, "ss-recordings", YT, T0 + 2 * HOUR)).toBe(false);
    expect(other.calls).toEqual([]);
  });
  it("only the room's most recent broadcast is looked at: outside the window, still live, or already set, nothing is attached", async () => {
    for (const rows of [
      [row({ started_at: iso(T0 - 40 * HOUR), ended_at: iso(T0 - 39 * HOUR), created_at: iso(T0 - 40 * HOUR) })], // long ago
      [row({ ended_at: null })], // still live
      [row({ recording_url: LOOM, recording_source: "admin" })],
      [row({ recording_source: "admin" })], // an admin removed it
      // Yesterday's has none, but today's (the latest) is still live: yesterday's is not guessed at.
      [row({ notice_id: "old", started_at: iso(T0 - 24 * HOUR), ended_at: iso(T0 - 23 * HOUR), created_at: iso(T0 - 24 * HOUR) }), row({ notice_id: "new", ended_at: null })],
      [],
    ]) {
      const { db, calls } = database(rows);
      expect(await attachStageRecordingFromPost(db, "lb-recordings", YT, T0 + 2 * HOUR)).toBe(false);
      expect(calls).toEqual([]);
    }
  });
  it("after a post: nothing at all unless it is a video link in a recordings room; never throws", async () => {
    stageRecordingAfterPost("main", `Look ${YT}`, iso(T0));
    stageRecordingAfterPost("lb-recordings", "Recording coming soon", iso(T0));
    expect(mocks.after).not.toHaveBeenCalled();
    mocks.db = { from: () => { throw new Error("down"); } };
    stageRecordingAfterPost("lb-recordings", YT, iso(T0 + 2 * HOUR));
    expect(mocks.after).toHaveBeenCalledTimes(1);
    await expect(mocks.after.mock.calls[0][0]()).resolves.toBeUndefined();
    mocks.db = null;
    await expect(mocks.after.mock.calls[0][0]()).resolves.toBeUndefined();
  });
});

describe("the player card", () => {
  it("Longboard Bot's ended notice with a recording gets the recordings rooms' own card", () => {
    const [video] = stageRecordingVideos("longboard", composeStageEndedNotice("LB", `${YT}&t=90s`));
    expect(video).toEqual({ kind: "youtube", id: "dQw4w9WgXcQ", start: 90, embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&start=90", label: "YouTube video", title: "Watch the recording" });
    expect(stageRecordingVideos("longboard", composeStageEndedNotice("Booker Stock Club", LOOM))[0]).toMatchObject({ kind: "loom", embedUrl: "https://www.loom.com/embed/0123456789abcdef0123456789abcdef?autoplay=1" });
  });
  it("nothing else in an ordinary room gets a player", () => {
    const ended = composeStageEndedNotice("LB", YT);
    // A person, an agent or another bot copying the words.
    for (const bot of [null, undefined, "buddy", "club", "ai-insights"]) expect(stageRecordingVideos(bot, ended)).toEqual([]);
    // The bot's other posts, a notice without a recording, one with a link that is not a video, and look-alikes.
    for (const body of [`New recording: ${YT}`, composeStageEndedNotice("LB"), "The live video in LB has ended.", composeStageEndedNotice("LB", "https://example.test/video"), `${ended} and more`, `Hello\n${ended}`])
      expect(stageRecordingVideos("longboard", body), body).toEqual([]);
    // The recordings rooms' own rule is unchanged: a link in an ordinary room is just a link.
    expect(recordingVideosFromText("main", ended)).toEqual([]);
    expect(recordingVideosFromText("club", `Watch ${YT}`)).toEqual([]);
  });
});
