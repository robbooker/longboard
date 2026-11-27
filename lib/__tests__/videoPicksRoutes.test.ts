import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// #529 Booker Tube routes: the daily job (cron secret, one bad feed, keep the last good list), the
// member's read (sign-in, caching) and the admin's channel upkeep (who, validation, feed check).
const mock = vi.hoisted(() => ({ auth: vi.fn(), admin: vi.fn(), origin: vi.fn(), member: vi.fn() }));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: mock.auth }));
vi.mock("@/lib/chatAdmin", () => ({ createChatAdminClient: mock.admin, requestOriginAllowed: mock.origin }));
vi.mock("@/lib/chatMembers", () => ({ findChatMember: mock.member }));

import * as cronRoute from "@/app/api/cron/video-picks/route";
import * as readRoute from "@/app/api/chat/video-picks/route";
import * as channelsRoute from "@/app/api/chat/video-picks/channels/route";
import * as refreshRoute from "@/app/api/chat/video-picks/refresh/route";
import { FEED_USER_AGENT, forgetPicksAnswer, refreshCollection } from "@/lib/videoPicksServer";

const DAY = 86_400_000;
const COLLECTION = "c0000000-0000-4000-8000-000000000001";
const A = "UCaaaaaaaaaaaaaaaaaaaaaa", B = "UCbbbbbbbbbbbbbbbbbbbbbb", C = "UCcccccccccccccccccccccc", NEW = "UCnnnnnnnnnnnnnnnnnnnnnn";
type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
let tables: Tables;
let rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
let failTable: string | null;

/** A small stand-in for the service-role client: the few calls these routes make, over arrays. */
function fakeDb() {
  const from = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    let op: "select" | "insert" | "delete" | "upsert" = "select";
    let payload: Row | null = null;
    let options: { onConflict?: string; ignoreDuplicates?: boolean } = {};
    let single = false;
    const run = () => {
      if (failTable === table) return { data: null, error: { code: "XX000", message: "down" } };
      const rows = (tables[table] ??= []);
      const match = (row: Row) => filters.every(([column, value]) => row[column] === value);
      if (op === "select") {
        const found = rows.filter(match);
        return { data: single ? (found[0] ?? null) : found, error: null };
      }
      if (op === "insert") {
        if (table === "chat_video_channels" && rows.some((row) => row.collection_id === payload!.collection_id && row.channel_id === payload!.channel_id))
          return { data: null, error: { code: "23505", message: "duplicate" } };
        rows.push({ position: 1000, note: null, ...payload });
        return { data: null, error: null };
      }
      if (op === "upsert") {
        const key = options.onConflict!;
        if (!rows.some((row) => row[key] === payload![key])) rows.push({ ...payload });
        return { data: null, error: null };
      }
      const removed = rows.filter(match);
      tables[table] = rows.filter((row) => !match(row));
      return { data: removed, error: null };
    };
    const chain: Record<string, unknown> = {
      select: () => chain,
      insert: (value: Row) => ((op = "insert"), (payload = value), chain),
      upsert: (value: Row, given: typeof options) => ((op = "upsert"), (payload = value), (options = given), chain),
      delete: () => ((op = "delete"), chain),
      eq: (column: string, value: unknown) => (filters.push([column, value]), chain),
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => ((single = true), chain),
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
    };
    return chain;
  };
  const rpc = async (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    if (failTable === name) return { data: null, error: { code: "XX000" } };
    const videos = args.p_videos as Array<Record<string, unknown>>;
    tables.chat_video_picks = [
      ...tables.chat_video_picks.filter((row) => row.collection_id !== args.p_collection),
      ...videos.map((video) => ({ collection_id: args.p_collection, video_id: video.id, channel_id: video.channelId, channel_name: video.channel, title: video.title, published_at: video.published, area: video.area, primary_topic: video.primaryTopic, topics: video.topics, snippet: video.snippet, score: video.score })),
    ];
    const collection = tables.chat_video_collections.find((row) => row.id === args.p_collection)!;
    collection.refreshed_at = new Date().toISOString();
    collection.refresh_stats = args.p_stats;
    return { data: videos.length, error: null };
  };
  return { from, rpc };
}

const channel = (channel_id: string, name: string, position: number, area = "trading", topics = ["low-float"]) => ({ collection_id: COLLECTION, channel_id, name, area, topics, note: "why it is here", position });
const stored = (video_id: string, channel_id: string, days: number, title = `Stored ${video_id}`): Row => ({ collection_id: COLLECTION, video_id, channel_id, channel_name: "Stored", title, published_at: new Date(Date.now() - days * DAY).toISOString(), area: "trading", primary_topic: "low-float", topics: ["low-float"], snippet: "", score: "7.50" });
const entry = (id: string, channelId: string, title: string, days = 2, shorts = false) =>
  `<entry><yt:videoId>${id}</yt:videoId><yt:channelId>${channelId}</yt:channelId><title>${title}</title><link rel="alternate" href="https://www.youtube.com/${shorts ? "shorts/" : "watch?v="}${id}"/><published>${new Date(Date.now() - days * DAY).toISOString()}</published><media:group><media:description>About it.</media:description></media:group></entry>`;
const feed = (channelId: string, name: string, ...entries: string[]) => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><yt:channelId>${channelId}</yt:channelId><title>${name}</title>${entries.join("")}</feed>`;

/** YouTube, faked: each address answers with a feed, a page, a status, or a network failure. */
let youtube: Record<string, string | number | Error>;
let requests: Array<{ url: string; headers: Headers; redirect: unknown }>;
const feedOf = (id: string) => `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;

const access = (admin = false) => ({ ok: true, user: { id: "user-1", email: "", role: admin ? "admin" : "user" }, access: { longboard: true, shortscout: false, admin }, serverSession: false });
const req = (url: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`https://chat.robbooker.com${url}`, { method, headers: { host: "chat.robbooker.com", ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const cron = (secret?: string) => cronRoute.GET(req("/api/cron/video-picks", "GET", undefined, secret === undefined ? {} : { authorization: `Bearer ${secret}` }));
const picks = () => tables.chat_video_picks.map((row) => row.video_id).sort();

beforeEach(() => {
  vi.clearAllMocks();
  forgetPicksAnswer();
  failTable = null;
  rpcCalls = [];
  requests = [];
  tables = {
    chat_video_collections: [{ id: COLLECTION, slug: "booker-tube", title: "Booker Tube", owner_member_id: null, visibility: "members", window_days: 90, scoring: { minScoreToInclude: 1 }, areas: [{ id: "trading", label: "Trading", tagline: "Tape" }, { id: "fun", label: "Fun", tagline: "" }], penalties: [{ phrase: "buy alert", penalty: 9 }], refreshed_at: null, refresh_stats: null }],
    chat_video_topics: [
      { collection_id: COLLECTION, topic_id: "low-float", area: "trading", label: "Low-float day trading", weight: "1.20", keywords: [{ phrase: "low float", weight: 3.5 }], position: 10 },
      { collection_id: COLLECTION, topic_id: "birds", area: "fun", label: "Birds", weight: "1.00", keywords: [{ phrase: "owl", weight: 3 }], position: 20 },
    ],
    chat_video_channels: [channel(A, "Alpha", 10), channel(B, "Beta", 20), channel(C, "Gamma", 30, "fun", ["birds"])],
    chat_video_picks: [],
    chat_pages: [],
  };
  youtube = {
    [feedOf(A)]: feed(A, "Alpha", entry("a1aaaaaaaaa", A, "Low float open"), entry("a2aaaaaaaaa", A, "Shorting the backside", 4), entry("a3aaaaaaaaa", A, "Clip", 1, true), entry("a4aaaaaaaaa", A, "Buy alert now", 1), entry("a5aaaaaaaaa", A, "Old one", 200)),
    [feedOf(B)]: feed(B, "Beta", entry("b1bbbbbbbbb", B, "Morning notes")),
    [feedOf(C)]: feed(C, "Gamma", entry("c1ccccccccc", C, "An owl at dusk")),
  };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    requests.push({ url: String(url), headers: new Headers(init.headers), redirect: init.redirect });
    const answer = youtube[String(url)];
    if (answer instanceof Error) throw answer;
    if (typeof answer === "number" || answer === undefined) return new Response("no", { status: answer ?? 404 });
    return new Response(answer, { status: 200 });
  });
  vi.stubEnv("CRON_SECRET", "cron-secret");
  mock.admin.mockReturnValue(fakeDb());
  mock.origin.mockReturnValue(true);
  mock.auth.mockResolvedValue(access());
  mock.member.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111" });
  vi.useFakeTimers({ toFake: ["setTimeout"] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
/** Runs a call to its end, letting the pauses between feeds pass at once. */
async function settle<T>(work: Promise<T>): Promise<T> {
  let done = false;
  const finished = work.finally(() => (done = true));
  while (!done) await vi.advanceTimersByTimeAsync(300);
  return finished;
}

describe("the daily job", () => {
  it("needs the cron secret", async () => {
    for (const secret of [undefined, "", "wrong", "cron-secret2", "CRON-SECRET"]) expect((await cron(secret)).status, String(secret)).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await cron("")).status).toBe(401);
    expect(requests).toEqual([]);
    expect(rpcCalls).toEqual([]);
  });

  it("reads each channel once, politely, and stores the scored list", async () => {
    const response = await settle(cron("cron-secret"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ stored: true, reason: "stored", channels: 3, succeeded: 3, failed: 0, parsed: 7, old: 1, shorts: 1, lowScore: 1, carried: 0, videos: 4 });
    // One request per channel, in order, to the fixed feed address, with a plain reader's name.
    expect(requests.map((request) => request.url)).toEqual([feedOf(A), feedOf(B), feedOf(C)]);
    for (const request of requests) {
      expect(request.headers.get("user-agent")).toBe(FEED_USER_AGENT);
      expect([...request.headers.keys()].sort()).toEqual(["accept", "user-agent"]);
    }
    expect(FEED_USER_AGENT).not.toMatch(/rob|booker|longboard|@|\.com/i);
    expect(picks()).toEqual(["a1aaaaaaaaa", "a2aaaaaaaaa", "b1bbbbbbbbb", "c1ccccccccc"]);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe("store_chat_video_refresh");
    const best = (rpcCalls[0].args.p_videos as Array<Record<string, unknown>>)[0];
    expect(best).toMatchObject({ id: "a1aaaaaaaaa", channel: "Alpha", channelId: A, area: "trading", primaryTopic: "low-float", topics: ["low-float"] });
    expect(Object.keys(best).sort()).toEqual(["area", "channel", "channelId", "id", "primaryTopic", "published", "score", "snippet", "title", "topics"]);
    // The page joins the sidebar with the first stored list, once.
    expect(tables.chat_pages).toEqual([{ slug: "booker-tube", kind: "video-picks", position: 40, name: "Booker Tube", built_in: true }]);
    await settle(cron("cron-secret"));
    expect(tables.chat_pages).toHaveLength(1);
  });

  it("pauses between feeds", async () => {
    const sleep = vi.fn(async () => {});
    await refreshCollection(fakeDb() as never, "booker-tube", { sleep });
    expect(sleep.mock.calls).toEqual([[250], [250]]);
  });

  it("one bad feed never fails the run: that channel keeps its last videos", async () => {
    tables.chat_video_picks = [stored("b0bbbbbbbbb", B, 10), stored("b9bbbbbbbbb", B, 120), stored("a0aaaaaaaaa", A, 10)];
    for (const failure of [503, new Error("socket hang up"), "<html>Sign in to continue</html>", Object.assign(new Error("slow"), { name: "TimeoutError" })]) {
      youtube[feedOf(B)] = failure;
      const body = await (await settle(cron("cron-secret"))).json();
      expect(body, String(failure)).toMatchObject({ stored: true, channels: 3, succeeded: 2, failed: 1, carried: 1, videos: 4 });
      // Beta's stored video inside the window is kept; its too-old one goes; Alpha's are replaced by its feed.
      expect(picks()).toEqual(["a1aaaaaaaaa", "a2aaaaaaaaa", "b0bbbbbbbbb", "c1ccccccccc"]);
      tables.chat_video_picks.push(stored("b9bbbbbbbbb", B, 120));
    }
    expect((tables.chat_video_collections[0].refresh_stats as { failed: unknown[] }).failed).toEqual([{ channelId: B, name: "Beta", error: "timed out" }]);
  });

  it("keeps the last good list when most feeds fail, or nothing comes back", async () => {
    const before = [stored("a0aaaaaaaaa", A, 10), stored("b0bbbbbbbbb", B, 10)];
    tables.chat_video_picks = [...before];
    youtube[feedOf(A)] = 500;
    youtube[feedOf(B)] = new Error("down");
    let response = await settle(cron("cron-secret"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ stored: false, reason: "most_feeds_failed", succeeded: 1, failed: 2 });
    expect(tables.chat_video_picks).toEqual(before);
    expect(rpcCalls).toEqual([]);
    expect(tables.chat_video_collections[0].refreshed_at).toBeNull();
    expect(tables.chat_pages).toEqual([]);
    // Every feed answers but with nothing in it: suspicious, so the old list stays.
    for (const id of [A, B, C]) youtube[feedOf(id)] = feed(id, "Empty");
    response = await settle(cron("cron-secret"));
    expect(await response.json()).toMatchObject({ stored: false, reason: "nothing_found", succeeded: 3, videos: 0 });
    expect(tables.chat_video_picks).toEqual(before);
    // Exactly half answering is enough.
    tables.chat_video_channels.push(channel(NEW, "Delta", 40));
    youtube = { [feedOf(A)]: feed(A, "Alpha", entry("a1aaaaaaaaa", A, "Low float open")), [feedOf(B)]: feed(B, "Beta", entry("b1bbbbbbbbb", B, "Notes")) };
    expect(await (await settle(cron("cron-secret"))).json()).toMatchObject({ stored: true, succeeded: 2, failed: 2 });
  });

  it("stops asking when it runs out of time, keeping what the unreached channels had", async () => {
    tables.chat_video_picks = [stored("c0ccccccccc", C, 5)];
    let clock = Date.now();
    const outcome = await refreshCollection(fakeDb() as never, "booker-tube", { now: () => (clock += 400), budgetMs: 1500, sleep: async () => {} });
    expect(outcome?.stats.failed).toEqual([{ channelId: C, name: "Gamma", error: "not reached in time" }]);
    expect(outcome?.stored).toBe(true);
    expect(requests.map((request) => request.url)).toEqual([feedOf(A), feedOf(B)]);
  });

  it("is quiet before the migration's collection exists, and says so when the database is down", async () => {
    tables.chat_video_collections = [];
    expect(await (await cron("cron-secret")).json()).toEqual({ ready: false });
    expect(requests).toEqual([]);
    failTable = "chat_video_collections";
    expect((await cron("cron-secret")).status).toBe(503);
    mock.admin.mockReturnValue(null);
    expect((await cron("cron-secret")).status).toBe(503);
  });

  it("reports a list that could not be stored, leaving the old one", async () => {
    tables.chat_video_picks = [stored("a0aaaaaaaaa", A, 10)];
    failTable = "store_chat_video_refresh";
    expect((await settle(cron("cron-secret"))).status).toBe(503);
    expect(picks()).toEqual(["a0aaaaaaaaa"]);
    expect(tables.chat_pages).toEqual([]);
  });
});

describe("the member's read", () => {
  const read = (headers: Record<string, string> = {}) => readRoute.GET(req("/api/chat/video-picks", "GET", undefined, headers));
  beforeEach(() => {
    tables.chat_video_picks = [stored("a0aaaaaaaaa", A, 10, "Low float open"), stored("c0ccccccccc", C, 3, "An owl")];
    tables.chat_video_collections[0].refreshed_at = "2026-11-26T09:40:00+00:00";
  });

  it("is for signed-in chat members only", async () => {
    mock.auth.mockResolvedValue({ ok: false, status: 401, error: "unauthenticated" });
    expect((await read()).status).toBe(401);
    mock.auth.mockResolvedValue({ ...access(), access: { longboard: false, shortscout: false, admin: false } });
    expect((await read()).status).toBe(403);
    mock.auth.mockResolvedValue(access());
    mock.member.mockResolvedValue(null);
    expect((await read()).status).toBe(403);
    for (const response of [await read()]) expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("answers with cards and filters only, cached for five minutes and never indexed", async () => {
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, max-age=300");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("vary")).toBe("Cookie");
    const body = await response.json();
    expect(body).toEqual({
      title: "Booker Tube",
      updatedAt: "2026-11-26T09:40:00.000Z",
      windowDays: 90,
      areas: [{ id: "trading", label: "Trading", tagline: "Tape" }, { id: "fun", label: "Fun", tagline: "" }],
      topics: [{ id: "low-float", area: "trading", label: "Low-float day trading" }, { id: "birds", area: "fun", label: "Birds" }],
      videos: [
        { id: "a0aaaaaaaaa", title: "Low float open", channel: "Stored", channelId: A, area: "trading", published: tables.chat_video_picks[0].published_at, snippet: "", topics: ["low-float"], primaryTopic: "low-float", score: 7.5 },
        expect.objectContaining({ id: "c0ccccccccc" }),
      ],
      canManage: false,
    });
    // Nothing about how the list is made: no phrases, weights, penalties or channel notes.
    expect(JSON.stringify(body)).not.toMatch(/keywords|low float"|penalt|buy alert|why it is here|weight/);
    // Unchanged: 304 with no body.
    const etag = response.headers.get("etag")!;
    const again = await read({ "if-none-match": etag });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    expect((await read({ "if-none-match": '"something-else"' })).status).toBe(200);
  });

  it("keeps the answer for five minutes on the server, and a refresh drops it", async () => {
    await read();
    tables.chat_video_picks = [];
    expect((await (await read()).json()).videos).toHaveLength(2);
    // An admin always reads the current list and keeps no copy.
    mock.auth.mockResolvedValue(access(true));
    const admin = await read();
    expect(admin.headers.get("cache-control")).toBe("private, no-store");
    expect(await admin.json()).toMatchObject({ canManage: true, videos: [] });
    mock.auth.mockResolvedValue(access());
    tables.chat_video_picks = [stored("a0aaaaaaaaa", A, 10)];
    expect((await (await read()).json()).videos).toHaveLength(0);
    await settle(cron("cron-secret"));
    expect((await (await read()).json()).videos).toHaveLength(4);
  });

  it("says when it is unavailable", async () => {
    failTable = "chat_video_picks";
    const down = await read();
    expect(down.status).toBe(503);
    expect(down.headers.get("cache-control")).toBe("private, no-store");
    failTable = null;
    tables.chat_video_collections = [];
    expect((await read()).status).toBe(404);
  });
});

describe("admin upkeep", () => {
  const add = (body: unknown) => channelsRoute.POST(req("/api/chat/video-picks/channels", "POST", body));
  const remove = (id: string) => channelsRoute.DELETE(req(`/api/chat/video-picks/channels?id=${encodeURIComponent(id)}`, "DELETE"));
  const list = () => channelsRoute.GET(req("/api/chat/video-picks/channels"));
  const refresh = () => refreshRoute.POST(req("/api/chat/video-picks/refresh", "POST"));
  const ids = () => tables.chat_video_channels.map((row) => row.channel_id);

  it("is closed to members, signed-out visitors and other sites", async () => {
    for (const call of [list, () => add({ channel: NEW, area: "fun" }), () => remove(A), refresh]) expect((await call()).status).toBe(403);
    mock.auth.mockResolvedValue({ ok: false, status: 401, error: "unauthenticated" });
    for (const call of [list, () => add({ channel: NEW, area: "fun" }), () => remove(A), refresh]) expect((await call()).status).toBe(401);
    mock.auth.mockResolvedValue(access(true));
    mock.origin.mockReturnValue(false);
    for (const call of [() => add({ channel: NEW, area: "fun" }), () => remove(A), refresh]) expect((await call()).status).toBe(403);
    expect(ids()).toEqual([A, B, C]);
    expect(requests).toEqual([]);
    expect(rpcCalls).toEqual([]);
  });

  describe("as an admin", () => {
    beforeEach(() => {
      mock.auth.mockResolvedValue(access(true));
      youtube[feedOf(NEW)] = feed(NEW, "New &amp; Noted", entry("n1nnnnnnnnn", NEW, "An owl in the snow"));
    });

    it("lists the channels and how the last refresh went", async () => {
      tables.chat_video_collections[0].refresh_stats = { videos: 9, succeeded: 2, channels: 3, failed: [{ channelId: B, name: "Beta", error: "HTTP 503" }], parsed: 30 };
      const response = await list();
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toEqual({
        channels: [{ channelId: A, name: "Alpha", area: "trading", topics: ["low-float"] }, { channelId: B, name: "Beta", area: "trading", topics: ["low-float"] }, { channelId: C, name: "Gamma", area: "fun", topics: ["birds"] }],
        lastRefresh: { videos: 9, succeeded: 2, channels: 3, failed: [{ name: "Beta", error: "HTTP 503" }] },
      });
    });

    it("adds a channel by id or channel address once its feed has answered", async () => {
      const response = await add({ channel: `https://www.youtube.com/channel/${NEW}`, area: "fun", topics: ["birds"] });
      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ channel: { channelId: NEW, name: "New & Noted", area: "fun", topics: ["birds"] } });
      expect(requests.map((request) => request.url)).toEqual([feedOf(NEW)]);
      expect(tables.chat_video_channels.at(-1)).toMatchObject({ collection_id: COLLECTION, channel_id: NEW, name: "New & Noted", area: "fun", topics: ["birds"], added_by: "11111111-1111-4111-8111-111111111111" });
      expect((await add({ channel: NEW, area: "fun" })).status).toBe(409);
      expect(ids()).toEqual([A, B, C, NEW]);
    });

    it("looks an @handle up on the channel's public page, and asks for the id when that fails", async () => {
      youtube["https://www.youtube.com/@newnoted"] = `<html><head><link rel="canonical" href="https://www.youtube.com/channel/${NEW}"></head></html>`;
      const response = await add({ channel: "https://www.youtube.com/@newnoted", area: "fun" });
      expect(response.status).toBe(201);
      expect(requests.map((request) => request.url)).toEqual(["https://www.youtube.com/@newnoted", feedOf(NEW)]);
      expect(requests[0].headers.get("user-agent")).toBe(FEED_USER_AGENT);
      expect(ids()).toEqual([A, B, C, NEW]);
      // A handle that resolves to a channel already listed.
      youtube["https://www.youtube.com/@alpha"] = `<link rel="canonical" href="https://www.youtube.com/channel/${A}">`;
      expect((await add({ channel: "@alpha", area: "fun" })).status).toBe(409);
      // No channel page (a consent wall, a 404, a network failure): a clear ask for the id, nothing saved.
      for (const answer of ["<html>Before you continue to YouTube</html>", 404, new Error("down")]) {
        youtube["https://www.youtube.com/@ghost"] = answer;
        const refused = await add({ channel: "@ghost", area: "fun" });
        expect(refused.status).toBe(400);
        expect((await refused.json()).error).toMatch(/Couldn't find @ghost .* starts with UC/);
      }
      expect(ids()).toEqual([A, B, C, NEW]);
    });

    it("saves nothing unless the feed resolves", async () => {
      for (const [answer, message] of [[404, /no public channel/], [500, /couldn't be read just now/], ["<html>not a feed</html>", /couldn't be read/], [new Error("down"), /couldn't be read/]] as const) {
        youtube[feedOf(NEW)] = answer;
        const response = await add({ channel: NEW, area: "fun" });
        expect(response.status).toBe(400);
        expect((await response.json()).error).toMatch(message);
      }
      expect(ids()).toEqual([A, B, C]);
    });

    it("refuses what it can't use, before asking YouTube anything", async () => {
      const cases: Array<[unknown, RegExp]> = [
        [{ channel: "", area: "fun" }, /Paste a channel id/],
        [{ area: "fun" }, /Paste a channel id/],
        [{ channel: "https://example.com/channel/" + NEW, area: "fun" }, /Paste a channel id/],
        [{ channel: "https://www.youtube.com/watch?v=a1aaaaaaaaa", area: "fun" }, /Paste a channel id/],
        [{ channel: NEW }, /Choose an area/],
        [{ channel: NEW, area: "cooking" }, /Choose an area/],
        [{ channel: NEW, area: "fun", topics: "birds" }, /up to 3 topics/],
        [{ channel: NEW, area: "fun", topics: ["birds", "birds"] }, /up to 3 topics/],
        [{ channel: NEW, area: "fun", topics: ["a", "b", "c", "d"] }, /up to 3 topics/],
        [{ channel: NEW, area: "fun", topics: ["low-float"] }, /topics from the channel's area/],
        [{ channel: NEW, area: "fun", topics: ["nonsense"] }, /topics from the channel's area/],
        [null, /Paste a channel id/],
      ];
      for (const [body, message] of cases) {
        const response = await add(body);
        expect(response.status, JSON.stringify(body)).toBe(400);
        expect((await response.json()).error).toMatch(message);
      }
      expect((await add({ channel: A, area: "fun" })).status).toBe(409);
      expect(requests).toEqual([]);
      expect(ids()).toEqual([A, B, C]);
    });

    it("stops at 80 channels", async () => {
      for (let index = 0; index < 77; index++) tables.chat_video_channels.push(channel(`UC${String(index).padStart(22, "x")}`, `Filler ${index}`, 100 + index));
      const response = await add({ channel: NEW, area: "fun" });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/full \(80 channels\)/);
      expect(requests).toEqual([]);
    });

    it("removes a channel and its videos at once", async () => {
      tables.chat_video_picks = [stored("a0aaaaaaaaa", A, 10), stored("a1aaaaaaaaa", A, 5), stored("c0ccccccccc", C, 3)];
      expect(await (await remove(A)).json()).toEqual({ removed: true, videosCleared: true });
      expect(ids()).toEqual([B, C]);
      expect(picks()).toEqual(["c0ccccccccc"]);
      expect((await remove(A)).status).toBe(404);
      for (const bad of ["", "nope", "UCshort", `${B}'; drop table x`]) expect((await remove(bad)).status, bad).toBe(400);
      expect(ids()).toEqual([B, C]);
    });

    it("refreshes on request, and says when the page kept its last list", async () => {
      let response = await settle(refresh());
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toEqual({ stored: true, reason: "stored", videos: 4, channels: 3, succeeded: 3, failed: [] });
      youtube[feedOf(A)] = 500;
      youtube[feedOf(B)] = 500;
      response = await settle(refresh());
      expect(await response.json()).toEqual({ stored: false, reason: "most_feeds_failed", videos: 0, channels: 3, succeeded: 1, failed: [{ name: "Alpha", error: "HTTP 500" }, { name: "Beta", error: "HTTP 500" }] });
      expect(picks()).toHaveLength(4);
    });
  });
});
