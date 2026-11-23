import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// #484 PRODUCER-FEED: the route's token check, that it only reads, and the empty-day answer.
// The database is a fake: each query records its table and filters and answers from `store`.
const { store, calls, news } = vi.hoisted(() => ({
  store: {
    alerts: [] as Array<{ id: string; created_at: string; body: string }>,
    facts: [] as Array<{ ticker: string; country: string | null }>,
    dt: [] as Array<Record<string, unknown>>,
    questions: [] as Array<Record<string, unknown>>,
    replies: [] as Array<Record<string, unknown>>,
    fail: false,
  },
  calls: [] as Array<{ table: string; ops: Array<[string, unknown[]]> }>,
  news: { polygon: { ok: true, articles: [] as unknown[] }, fmp: { configured: true, okReads: 2, reads: 2, articles: [] as unknown[] } },
}));

function query(table: string) {
  const entry = { table, ops: [] as Array<[string, unknown[]]> };
  calls.push(entry);
  const has = (op: string, ...args: unknown[]) =>
    entry.ops.some(([name, a]) => name === op && args.every((v, i) => a[i] === v));
  const answer = () => {
    if (store.fail) return { data: null, error: { message: "down" } };
    if (table === "chat_gainers_facts") return { data: store.facts, error: null };
    if (has("eq", "room_slug", "gainers")) return { data: store.alerts, error: null };
    if (has("in", "reply_to_id")) return { data: store.replies, error: null };
    if (has("eq", "room_slug", "shortscout")) return { data: store.questions, error: null };
    return { data: [], error: null };
  };
  const builder: Record<string, unknown> = {};
  for (const name of ["select", "eq", "is", "not", "in", "gte", "lt", "order", "range", "limit"])
    builder[name] = (...args: unknown[]) => {
      entry.ops.push([name, args]);
      return builder;
    };
  builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(answer()).then(resolve, reject);
  return builder;
}
const writes = ["insert", "update", "upsert", "delete"];
vi.mock("@/lib/chatAdmin", () => ({
  createChatAdminClient: () => ({
    from: (table: string) => {
      const q = query(table);
      for (const w of writes) q[w] = () => { throw new Error(`write ${w} on ${table}`); };
      return q;
    },
    rpc: async (name: string) => {
      calls.push({ table: `rpc:${name}`, ops: [] });
      if (store.fail) return { data: null, error: { message: "down" } };
      return name === "chat_gainers_news_for" ? { data: store.dt, error: null } : { data: null, error: { message: "nope" } };
    },
  }),
}));
vi.mock("@/lib/chatNewsPolygon", () => ({ cachedNews: async () => news.polygon }));
vi.mock("@/lib/chatNewsFmp", () => ({ readFmpNews: async () => news.fmp }));

import { GET } from "@/app/api/producer/morning/route";
import { MISSING } from "@/lib/producerFeed";

const TOKEN = "p".repeat(40);
const get = (qs = "", token: string | null = TOKEN) =>
  GET(new NextRequest(`https://chat.example.test/api/producer/morning${qs}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-23T12:50:00Z")); // 7:50am New York, Monday
  vi.stubEnv("PRODUCER_FEED_TOKEN", TOKEN);
  vi.stubEnv("POLYGON_API_KEY", "polygon-test");
  Object.assign(store, { alerts: [], facts: [], dt: [], questions: [], replies: [], fail: false });
  news.polygon = { ok: true, articles: [] };
  news.fmp = { configured: true, okReads: 2, reads: 2, articles: [] };
  calls.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("/api/producer/morning", () => {
  it("fails closed without the token setting", async () => {
    vi.stubEnv("PRODUCER_FEED_TOKEN", "");
    expect((await get()).status).toBe(503);
    vi.stubEnv("PRODUCER_FEED_TOKEN", "short");
    expect((await get("", "short")).status).toBe(503);
    expect(calls).toHaveLength(0);
  });
  it("refuses a wrong or missing token", async () => {
    expect((await get("", "x".repeat(40))).status).toBe(401);
    expect((await get("", null)).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
  it("refuses a bad date or limit", async () => {
    expect((await get("?date=2026-13-01")).status).toBe(400);
    expect((await get("?limit=11")).status).toBe(400);
  });
  it("answers an empty day with empty parts and a note for each", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      date: "2026-11-23",
      generated_at: "2026-11-23T12:50:00.000Z",
      gainers: [],
      market_headlines: [],
      question: null,
      missing: [MISSING.gainers, MISSING.headlines, MISSING.question],
    });
  });
  it("still answers 200 when the database and Polygon fail", async () => {
    store.fail = true;
    news.polygon = { ok: false, articles: [] };
    const body = await (await get()).json();
    expect(body.missing).toEqual([MISSING.gainersError, MISSING.polygonError, MISSING.headlines, MISSING.questionError]);
  });
  it("reads only the gainers and ShortScout rooms, and never writes", async () => {
    store.alerts = [
      { id: "1", created_at: "2026-11-23T11:00:00Z", body: "🚨 ABCD (+84.2%) 🕒 Pre-Market\n🕒 Extended Price: $3.12\n📊 Volume: 400,000" },
    ];
    store.facts = [{ ticker: "ABCD", country: "China" }];
    store.dt = [{ ticker: "ABCD", published_at: "2026-11-23T10:30:00Z", title: "ABCD signs a deal", url: "https://dilution.news/a" }];
    store.questions = [
      { id: "q1", author_label: "Sam Ortiz", body: "What's the best way to size a premarket short?", created_at: "2026-11-23T12:00:00Z", reply_to_id: null, member_id: "m1", bot_slug: null, agent_id: null, deleted_at: null, removed: false },
    ];
    const body = await (await get()).json();
    expect(body.gainers).toEqual([
      {
        symbol: "ABCD",
        change_pct: 84.2,
        price: 3.12,
        first_alert_at: "2026-11-23T11:00:00.000Z",
        country: "China",
        headlines: [{ title: "ABCD signs a deal", published_at: "2026-11-23T10:30:00.000Z", source: "DilutionTracker", url: "https://dilution.news/a" }],
      },
    ]);
    expect(body.question).toEqual({ first_name: "Sam", body: "What's the best way to size a premarket short?", posted_at: "2026-11-23T12:00:00.000Z" });
    const rooms = calls.flatMap((c) => c.ops.filter(([n, a]) => n === "eq" && a[0] === "room_slug").map(([, a]) => a[1]));
    expect(new Set(rooms)).toEqual(new Set(["gainers", "shortscout"]));
    expect(calls.map((c) => c.table).every((t) => ["longboard_chat_messages", "chat_gainers_facts", "rpc:chat_gainers_news_for"].includes(t))).toBe(true);
    // The question window starts at Friday's 4pm New York close.
    const questionRead = calls.find((c) => c.ops.some(([n, a]) => n === "eq" && a[1] === "shortscout") && !c.ops.some(([n]) => n === "in"))!;
    expect(questionRead.ops).toContainEqual(["gte", ["created_at", "2026-11-20T21:00:00.000Z"]]);
  });
  it("leaves market headlines out for a past date", async () => {
    const body = await (await get("?date=2026-11-20")).json();
    expect(body.date).toBe("2026-11-20");
    expect(body.missing).toContain(MISSING.headlinesPast);
  });
});
