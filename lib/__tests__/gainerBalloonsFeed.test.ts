import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// #528 Gainer Balloons: /api/chat/balloons and the feed behind it. Sign-in, the day's list (the
// Gainers Table's own function) and Polygon are all stand-ins; nothing real is read.
const { auth, state } = vi.hoisted(() => ({
  auth: vi.fn(),
  state: { rows: {} as Record<string, unknown[]>, rpcFails: false, noDb: false, rpcCalls: [] as string[], volumes: new Map<string, number>() },
}));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: auth }));
vi.mock("@/lib/chatAdmin", () => ({
  createChatAdminClient: () =>
    state.noDb
      ? null
      : {
          rpc: async (name: string, args: { p_day: string }) => {
            state.rpcCalls.push(`${name}:${args.p_day}`);
            if (state.rpcFails || name !== "chat_gainers_table") return { data: null, error: { message: "boom" } };
            return { data: state.rows[args.p_day] ?? [], error: null };
          },
        },
}));
vi.mock("@/lib/chatGainersQuotes", () => ({
  gainersSnapshots: async (tickers: string[]) => new Map(tickers.map((t) => [t, { quote: { price: 1, changePct: 1, volume: state.volumes.get(t) ?? null }, prevClose: null }])),
}));
import { GET } from "@/app/api/chat/balloons/route";
import { BARS_DONE_TTL_MS, BARS_TTL_MS, capRows, dayWindow, resetBalloonsFeed } from "@/lib/gainerBalloons/feed.server";
import { MAX_BALLOONS } from "@/lib/gainerBalloons/config";
import type { BalloonsFeed } from "@/lib/gainerBalloons/data";
import { resetGainersShares } from "@/lib/chatGainersShares";

const KEY = "test-only-polygon-key";
const member = { ok: true as const, user: { id: "11111111-1111-4111-8111-111111111111", email: "m@example.test", role: "user" as const }, access: { longboard: true, boardroom: true, shortscout: false, admin: true }, serverSession: false };
// A bot with only the Social room: signed in, but without Gainers.
const outsider = { ...member, access: { longboard: false, boardroom: false, shortscout: false, admin: false, botRooms: ["social"] } };
const WED = "2026-11-25";
// Wednesday 10:00 AM in New York.
const TEN_AM = Date.parse("2026-11-25T15:00:00Z");
const row = (ticker: string, extra: Record<string, unknown> = {}) => ({ ticker, alerts: 1, country: "U.S.", float_shares: "2500000", any_not_after_hours: true, after_hours_high: null, ...extra });

const fetchMock = vi.fn();
type Call = { ticker: string; span: string; url: URL };
const calls = (): Call[] =>
  fetchMock.mock.calls.map(([url]) => {
    const parsed = new URL(String(url));
    const [, ticker, span] = parsed.pathname.match(/\/ticker\/([^/]+)\/range\/\d+\/(minute|day)\//) ?? [];
    // #533: the ticker details read (shares outstanding) is its own kind of call.
    const [, detailsTicker] = parsed.pathname.match(/^\/v3\/reference\/tickers\/([^/]+)$/) ?? [];
    return detailsTicker ? { ticker: detailsTicker, span: "details", url: parsed } : { ticker, span, url: parsed };
  });
const count = (span: string, ticker?: string) => calls().filter((c) => c.span === span && (!ticker || c.ticker === ticker)).length;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
/** A Polygon that answers every stock: two 2-minute bars from 9:30 and a previous close of 2. */
function polygon(override?: (call: Call) => Response | undefined) {
  fetchMock.mockImplementation(async (url: unknown) => {
    const call = calls().at(-1)!;
    void url;
    const special = override?.(call);
    if (special) return special;
    if (call.span === "details") return json({ results: call.ticker === "AAA" ? { weighted_shares_outstanding: 12_000_000, share_class_shares_outstanding: 9_000_000 } : {} });
    if (call.span === "day") return json({ results: [{ t: 1, o: 1.9, h: 2.1, l: 1.8, c: 1.95, v: 10 }, { t: 2, o: 2, h: 2, l: 2, c: 2, v: 10 }] });
    const open = dayWindow(WED).startMs + 5.5 * 3_600_000;
    return json({ results: [{ t: open, o: 2, h: 2.5, l: 2, c: 2.4, v: 1000 }, { t: open + 120_000, o: 2.4, h: 2.6, l: 2.3, c: 2.5, v: 500 }] });
  });
}
const get = async (query = "") => {
  const response = await GET(new NextRequest(`https://chat.example.test/api/chat/balloons${query}`));
  return { response, body: (await response.json()) as BalloonsFeed & { error?: string } };
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TEN_AM);
  resetBalloonsFeed();
  resetGainersShares();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("POLYGON_API_KEY", KEY);
  auth.mockResolvedValue(member);
  Object.assign(state, { rows: { [WED]: [row("AAA", { country: "China Hong Kong", float_shares: 900000 }), row("BBB", { country: null, float_shares: null })] }, rpcFails: false, noDb: false, rpcCalls: [] });
  state.volumes.clear();
  polygon();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("GET /api/chat/balloons", () => {
  it("refuses someone signed out, a member without the Gainers room, and answers 503 without a database", async () => {
    auth.mockResolvedValueOnce({ ok: false, status: 401, error: "sign_in_required" });
    expect((await get()).response.status).toBe(401);
    auth.mockResolvedValueOnce(outsider);
    const refused = await get();
    expect(refused.response.status).toBe(403);
    expect(refused.body.error).toBe("room_access_required");
    state.noDb = true;
    expect((await get()).response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers today's gainers with country, float, previous close and the day's 2-minute bars", async () => {
    const { response, body } = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body).toMatchObject({ day: WED, today: WED, barMinutes: 2, since: null, now: TEN_AM });
    expect(body.stocks.map((s) => [s.ticker, s.country, s.floatShares, s.prevClose, s.bars.length, s.earlier])).toEqual([
      ["AAA", "China Hong Kong", 900_000, 2, 2, 0],
      ["BBB", null, null, 2, 2, 0],
    ]);
    expect(body.stocks[0].bars[0]).toEqual([dayWindow(WED).startMs + 5.5 * 3_600_000, 2, 2.5, 2, 2.4, 1000]);
    // 2-minute bars for the day's 4:00 AM to 8:00 PM, and the daily bars before it.
    const bars = calls().find((c) => c.span === "minute" && c.ticker === "AAA")!;
    expect(bars.url.pathname).toBe(`/v2/aggs/ticker/AAA/range/2/minute/${dayWindow(WED).startMs}/${dayWindow(WED).endMs - 1}`);
    expect(calls().find((c) => c.span === "day")!.url.pathname).toBe("/v2/aggs/ticker/AAA/range/1/day/2026-11-15/2026-11-24");
    // Nothing says where the numbers came from, and the key never leaves.
    const text = JSON.stringify(body);
    expect(text).not.toContain(KEY);
    expect(text.toLowerCase()).not.toMatch(/polygon|source|apikey/);
  });

  it("#533: sends institutional ownership from the saved company facts and the shares outstanding for the market cap", async () => {
    state.rows[WED] = [
      row("AAA", { inst_own_pct: "12.4", inst_own_checked_at: "2026-11-25T12:00:00Z" }),
      row("BBB", { inst_own_pct: 0, inst_own_checked_at: "2026-11-25T12:00:00Z" }),
      // Looked up, and there was none; never looked up; and a number that isn't a percent.
      row("CCC", { inst_own_pct: null, inst_own_checked_at: "2026-11-25T12:00:00Z" }),
      row("DDD"),
      row("EEE", { inst_own_pct: -3, inst_own_checked_at: "2026-11-25T12:00:00Z" }),
    ];
    const { body } = await get();
    expect(body.stocks.map((s) => [s.ticker, s.instOwnPct, s.sharesOutstanding])).toEqual([
      ["AAA", 12.4, 12_000_000],
      ["BBB", 0, null],
      ["CCC", null, null],
      ["DDD", null, null],
      ["EEE", null, null],
    ]);
    expect(calls().find((c) => c.span === "details")!.url.pathname).toBe("/v3/reference/tickers/AAA");
    expect(JSON.stringify(body)).not.toContain(KEY);
  });

  it("#533: reads a stock's shares once a day (an hour when there was no count), not with every minute's bars", async () => {
    await Promise.all(Array.from({ length: 12 }, () => get()));
    expect([count("details", "AAA"), count("details", "BBB")]).toEqual([1, 1]);
    for (let minute = 1; minute <= 59; minute++) {
      vi.setSystemTime(TEN_AM + minute * 60_000);
      await get();
    }
    expect(count("details")).toBe(2);
    // An hour on, the stock without a count is asked again; the one with a count waits a day.
    vi.setSystemTime(TEN_AM + 3_600_000 + 1_000);
    await get();
    expect([count("details", "AAA"), count("details", "BBB")]).toEqual([1, 2]);
    vi.setSystemTime(TEN_AM + 24 * 3_600_000 + 1_000);
    await get();
    expect(count("details", "AAA")).toBe(2);
  });

  it("#533: answers with the bars and no shares when the shares read fails or never comes back", async () => {
    polygon((call) => (call.span === "details" && call.ticker === "AAA" ? json({ status: "ERROR" }, 500) : undefined));
    const failed = await get();
    expect(failed.body.stocks.map((s) => [s.ticker, s.sharesOutstanding, s.bars.length])).toEqual([["AAA", null, 2], ["BBB", null, 2]]);
    resetBalloonsFeed();
    resetGainersShares();
    fetchMock.mockReset();
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(TEN_AM);
    fetchMock.mockImplementation(async (url: unknown) => {
      if (String(url).includes("/v3/reference/tickers/")) return new Promise<Response>(() => {});
      return String(url).includes("/day/") ? json({ results: [{ t: 2, o: 2, h: 2, l: 2, c: 2, v: 10 }] }) : json({ results: [] });
    });
    const pending = get();
    await vi.advanceTimersByTimeAsync(3_100);
    const slow = await pending;
    expect(slow.response.status).toBe(200);
    expect(slow.body.stocks.map((s) => [s.ticker, s.sharesOutstanding, s.prevClose])).toEqual([["AAA", null, 2], ["BBB", null, 2]]);
  });

  it("reads Polygon once per stock per minute, however many members ask", async () => {
    await Promise.all(Array.from({ length: 12 }, () => get()));
    expect(count("minute")).toBe(2);
    expect(count("day")).toBe(2);
    vi.setSystemTime(TEN_AM + BARS_TTL_MS - 1_000);
    await get();
    expect(count("minute")).toBe(2);
    vi.setSystemTime(TEN_AM + BARS_TTL_MS + 1_000);
    await Promise.all([get(), get(), get()]);
    expect(count("minute")).toBe(4);
    // Yesterday's close is read once a day, not once a minute.
    expect(count("day")).toBe(2);
    // The list itself comes from the database at most once in 30 seconds.
    expect(state.rpcCalls.length).toBe(2);
  });

  it("caps the list at 60, keeping the stocks with the most volume, and asks Polygon only for those", async () => {
    const many = Array.from({ length: 75 }, (_, i) => row(`T${String(i).padStart(2, "0")}`, { alerts: 1 }));
    state.rows[WED] = many;
    many.forEach((r, i) => state.volumes.set(r.ticker, i * 1000));
    const { body } = await get();
    expect(body.stocks).toHaveLength(MAX_BALLOONS);
    expect(body.stocks.map((s) => s.ticker)).toContain("T74");
    expect(body.stocks.map((s) => s.ticker)).not.toContain("T14");
    expect(new Set(calls().map((c) => c.ticker)).size).toBe(MAX_BALLOONS);
    expect(count("minute")).toBe(MAX_BALLOONS);
  });
  it("capRows: volume first, then alerts, and nothing to do under the cap", () => {
    const rows = [{ ticker: "A", alerts: 9 }, { ticker: "B", alerts: 1 }, { ticker: "C", alerts: 5 }];
    expect(capRows(rows, new Map(), 3)).toBe(rows);
    expect(capRows(rows, new Map([["B", 500]]), 2).map((r) => r.ticker)).toEqual(["B", "A"]);
    expect(capRows(rows, new Map(), 2).map((r) => r.ticker)).toEqual(["A", "C"]);
  });

  it("follows next_url so a long day's bars are never cut short", async () => {
    const open = dayWindow(WED).startMs;
    polygon((call) => {
      if (call.span !== "minute") return undefined;
      if (call.url.searchParams.get("cursor")) return json({ results: [{ t: open + 120_000, o: 1, h: 1, l: 1, c: 1.1, v: 7 }] });
      return json({ results: [{ t: open, o: 1, h: 1, l: 1, c: 1, v: 5 }], next_url: `https://api.polygon.io/v2/aggs/ticker/${call.ticker}/range/2/minute/1/2?cursor=abc` });
    });
    const { body } = await get();
    expect(body.stocks[0].bars.map((b) => b[5])).toEqual([5, 7]);
  });

  it("keeps the picture when Polygon fails: the stock stays, its earlier bars stay, and it waits a minute to ask again", async () => {
    polygon((call) => (call.ticker === "BBB" && call.span === "minute" ? json({ error: `bad ${KEY}` }, 500) : undefined));
    const first = await get();
    expect(first.response.status).toBe(200);
    expect(first.body.stocks.map((s) => [s.ticker, s.bars.length])).toEqual([["AAA", 2], ["BBB", 0]]);
    expect(JSON.stringify(first.body)).not.toContain(KEY);
    // Asked again only after the minute, not on every request.
    await get();
    expect(count("minute", "BBB")).toBe(1);
    // It recovers, then fails again: the bars it had are kept.
    polygon();
    vi.setSystemTime(TEN_AM + BARS_TTL_MS + 1_000);
    expect((await get()).body.stocks[1].bars).toHaveLength(2);
    fetchMock.mockRejectedValue(new Error("network down"));
    vi.setSystemTime(TEN_AM + 2 * BARS_TTL_MS + 2_000);
    const third = await get();
    expect(third.response.status).toBe(200);
    expect(third.body.stocks.map((s) => s.bars.length)).toEqual([2, 2]);
  });
  it("answers without a Polygon key: the stocks, with no bars and no previous close", async () => {
    vi.stubEnv("POLYGON_API_KEY", "");
    const { body } = await get();
    expect(body.stocks.map((s) => [s.ticker, s.prevClose, s.bars])).toEqual([["AAA", null, []], ["BBB", null, []]]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("answers 503 when the day's list can't be read", async () => {
    state.rpcFails = true;
    expect((await get()).response.status).toBe(503);
  });

  it("sends only the newest bars for ?since=, with the count of earlier ones", async () => {
    await get();
    const second = dayWindow(WED).startMs + 5.5 * 3_600_000 + 120_000;
    const { body } = await get(`?since=${second}`);
    expect(body.since).toBe(second);
    expect(body.stocks.map((s) => [s.ticker, s.earlier, s.bars.length])).toEqual([["AAA", 1, 1], ["BBB", 1, 1]]);
    expect((await get(`?since=${second + 10 * 60_000}`)).body.stocks[0]).toMatchObject({ earlier: 2, bars: [] });
    // Nonsense is ignored: the whole day comes back.
    for (const bad of ["?since=abc", "?since=-5", "?since=12", "?since=1e400"]) expect((await get(bad)).body.since).toBeNull();
  });

  it("leaves off a stock that only bounced after hours, still under yesterday's close (the Gainers Table's rule)", async () => {
    state.rows[WED] = [row("AAA"), row("AHDN", { any_not_after_hours: false, after_hours_high: 1.5 }), row("AHUP", { any_not_after_hours: false, after_hours_high: 2.5 })];
    expect((await get()).body.stocks.map((s) => s.ticker)).toEqual(["AAA", "AHUP"]);
  });
  it("ignores a ticker that isn't one", async () => {
    state.rows[WED] = [row("AAA"), row("../etc"), row("lower"), row("BRK.B"), { ticker: 5 }];
    expect((await get()).body.stocks.map((s) => s.ticker)).toEqual(["AAA", "BRK.B"]);
  });
});

describe("which day", () => {
  it("shows the most recent day with gainers on a weekend, a holiday or before the first alert", async () => {
    // Saturday: Friday had gainers.
    vi.setSystemTime(Date.parse("2026-11-28T15:00:00Z"));
    state.rows = { "2026-11-27": [row("FRI")], [WED]: [row("AAA")] };
    const saturday = await get();
    expect(saturday.body).toMatchObject({ day: "2026-11-27", today: "2026-11-28" });
    expect(saturday.body.stocks.map((s) => s.ticker)).toEqual(["FRI"]);
    // A finished day's bars are final: read once, then not again a minute later.
    expect(count("minute")).toBe(1);
    vi.setSystemTime(Date.parse("2026-11-28T15:00:00Z") + BARS_TTL_MS * 5);
    await get();
    expect(count("minute")).toBe(1);
    vi.setSystemTime(Date.parse("2026-11-28T15:00:00Z") + BARS_DONE_TTL_MS + 60_000);
    await get();
    expect(count("minute")).toBe(2);
  });
  it("skips weekends and days without gainers on the way back", async () => {
    // Monday 5:00 AM, nothing yet today; Thursday was a holiday.
    vi.setSystemTime(Date.parse("2026-11-30T10:00:00Z"));
    state.rows = { [WED]: [row("AAA")] };
    const { body } = await get();
    expect(body).toMatchObject({ day: WED, today: "2026-11-30" });
    expect(state.rpcCalls).not.toContain("chat_gainers_table:2026-11-29");
    expect(state.rpcCalls).not.toContain("chat_gainers_table:2026-11-28");
    expect(state.rpcCalls).toContain("chat_gainers_table:2026-11-26");
    // Yesterday's close for that day is the day before it, not the day before today.
    expect(calls().find((c) => c.span === "day")!.url.pathname).toMatch(/\/2026-11-15\/2026-11-24$/);
  });
  it("answers an empty today when no recent day had any", async () => {
    state.rows = {};
    const { response, body } = await get();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ day: WED, today: WED, stocks: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("moves to today as soon as today has a gainer", async () => {
    vi.setSystemTime(Date.parse("2026-11-27T10:00:00Z"));
    state.rows = { [WED]: [row("AAA")] };
    expect((await get()).body.day).toBe(WED);
    state.rows["2026-11-27"] = [row("NEW")];
    vi.setSystemTime(Date.parse("2026-11-27T10:00:31Z"));
    expect((await get()).body).toMatchObject({ day: "2026-11-27", stocks: [{ ticker: "NEW" }] });
  });
});
