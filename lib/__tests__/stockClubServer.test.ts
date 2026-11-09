// #386 Booker Stock Club: the 15-minute run end to end against a fake database and a fake Polygon:
// the morning report's rules, Rob's country weighting, one post per new #1, the admin lock, and the
// lookup program's extra tickers. No real service is reached.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

type Snap = { ticker: string; changePct: number; lastPrice: number; volume: number };
let snapshots: Snap[] = [];
const refs: Record<string, { type: string; name: string; marketCap: number }> = {};
vi.mock("@/lib/morning-email/polygon", async (original) => {
  const real = await original<typeof import("@/lib/morning-email/polygon")>();
  const ref = async (ticker: string) => (refs[ticker] ? { ticker, shareClassShares: null, weightedSharesOutstanding: null, ...refs[ticker] } : null);
  return {
    ...real,
    fetchPolygonTickerSnapshots: async () => snapshots.map((s) => ({ ...s, dollarChange: 0, providerUpdatedAt: null })),
    fetchSingleSnapshot: async (ticker: string) => {
      const s = snapshots.find((x) => x.ticker === ticker);
      return s ? { ...s, dollarChange: 0, providerUpdatedAt: null } : null;
    },
    fetchPolygonReference: ref,
    // The real filter, with the fake reference lookup.
    pickMoverCandidates: (c: Parameters<typeof real.pickMoverCandidates>[0], limit: number, qa: Parameters<typeof real.pickMoverCandidates>[2]) =>
      real.pickMoverCandidates(c, limit, qa, ref),
  };
});
const aggs = vi.fn(async (..._args: unknown[]) => [] as { t: number; o: number; h: number; l: number; c: number; v: number }[]);
vi.mock("@/lib/polygon/client", async (original) => ({ ...(await original<object>()), polygonAggsAll: (...args: unknown[]) => aggs(...args) }));

// A small in-memory stand-in for the tables and post_chat_club_pick (same rule as the SQL).
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
function query(table: string) {
  const filters: [string, string, unknown][] = [];
  let single = false;
  let sortDesc = false;
  const rows = () => {
    const found = tables[table].filter((row) => filters.every(([op, k, v]) => (op === "eq" ? row[k] === v : (v as unknown[]).includes(row[k]))));
    return sortDesc ? found.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))) : found;
  };
  const q = {
    select: () => q,
    eq: (k: string, v: unknown) => (filters.push(["eq", k, v]), q),
    in: (k: string, v: unknown[]) => (filters.push(["in", k, v]), q),
    // Newest first by created_at (only the archive query orders that way).
    order: (k: string, opts?: { ascending?: boolean }) => (k === "created_at" && opts?.ascending === false && (sortDesc = true), q),
    limit: () => q,
    maybeSingle: () => ((single = true), q),
    upsert: async (row: Row) => {
      const found = tables[table].find((r) => r.day === row.day);
      if (found) Object.assign(found, row);
      else tables[table].push({ locked: false, ...row });
      return { error: null };
    },
    update: (patch: Row) => ({
      eq: async (k: string, v: unknown) => {
        tables[table].filter((r) => r[k] === v).forEach((r) => Object.assign(r, patch));
        return { error: null };
      },
    }),
    then: (resolve: (v: unknown) => void) => resolve({ data: single ? (rows()[0] ?? null) : rows(), error: null }),
  };
  return q;
}
let posts: { ticker: string; source: string; body: string; data: Row }[];
const db = {
  from: (table: string) => query(table),
  rpc: async (name: string, args: Row) => {
    if (name === "chat_gainers_borrow_day") return { data: tables.chat_gainers_borrow, error: null };
    if (name !== "post_chat_club_pick") return { data: null, error: { message: "unknown" } };
    let day = tables.chat_club_days.find((d) => d.day === args.p_day);
    if (!day) tables.chat_club_days.push((day = { day: args.p_day, locked: false, candidates: [] }));
    if (args.p_source === "auto") {
      if (day.locked) return { data: { posted: false, reason: "locked" }, error: null };
      if (tables.chat_club_picks.some((p) => p.day === args.p_day && p.ticker === args.p_ticker))
        return { data: { posted: false, reason: "already_posted" }, error: null };
    } else day.locked = true;
    const id = `00000000-0000-4000-8000-${String(tables.chat_club_picks.length + 1).padStart(12, "0")}`;
    tables.chat_club_picks.push({ message_id: id, day: args.p_day, ticker: args.p_ticker, source: args.p_source, data: args.p_data, created_at: new Date().toISOString() });
    posts.push({ ticker: args.p_ticker as string, source: args.p_source as string, body: args.p_body as string, data: args.p_data as Row });
    return { data: { posted: true, messageId: id }, error: null };
  },
} as unknown as SupabaseClient;

const { runStockClubTick, postAdminPick, postReportPick, resumeAutomatic, clubLookupNeeds, inClubWindow, scanFallbackOpen, readReportTop } = await import("@/lib/stockClubServer");
const NOW = new Date("2026-11-06T15:00:00Z"); // 10:00 AM New York, a Friday.
const country = (ticker: string, value: string | null) =>
  tables.chat_gainers_facts.push({ ticker, country: value, country_checked_at: value ? "2026-11-06T14:00:00Z" : null, inst_own_pct: "5.5", inst_own_checked_at: "2026-11-06T14:00:00Z", cash_checked_at: "2026-11-06T14:00:00Z", not_found: false, checked_at: "2026-11-06T14:00:00Z" });

beforeEach(() => {
  tables = { chat_club_days: [], chat_club_picks: [], chat_gainers_facts: [], chat_gainers_borrow: [], morning_email_archive: [] };
  posts = [];
  aggs.mockClear();
  snapshots = [
    { ticker: "USAA", changePct: 150, lastPrice: 4, volume: 2_000_000 },
    { ticker: "NEWA", changePct: 90, lastPrice: 3, volume: 900_000 },
    { ticker: "CNAA", changePct: 60, lastPrice: 2.5, volume: 800_000 },
    { ticker: "THIN", changePct: 400, lastPrice: 2, volume: 100_000 }, // under 500K shares
    { ticker: "PENY", changePct: 300, lastPrice: 0.5, volume: 9_000_000 }, // under $1
    { ticker: "BIGG", changePct: 200, lastPrice: 5, volume: 9_000_000 }, // market cap too big
    { ticker: "ABCDW", changePct: 250, lastPrice: 2, volume: 9_000_000 }, // warrant
    { ticker: "SPAC", changePct: 220, lastPrice: 10, volume: 9_000_000 }, // blank check
  ];
  Object.assign(refs, {
    USAA: { type: "CS", name: "US Alpha", marketCap: 40e6 },
    NEWA: { type: "CS", name: "New Alpha", marketCap: 30e6 },
    CNAA: { type: "CS", name: "China Alpha", marketCap: 20e6 },
    THIN: { type: "CS", name: "Thin", marketCap: 10e6 },
    PENY: { type: "CS", name: "Penny", marketCap: 10e6 },
    BIGG: { type: "CS", name: "Big", marketCap: 500e6 },
    ABCDW: { type: "WARRANT", name: "Warrant", marketCap: 1e6 },
    SPAC: { type: "CS", name: "Example Acquisition Corp", marketCap: 50e6 },
  });
  country("USAA", "U.S.");
});

describe("the 15-minute run", () => {
  it("uses the morning report's rules, posts the #1 once, and saves the ranked candidates", async () => {
    const first = await runStockClubTick(db, NOW);
    expect(first).toMatchObject({ status: "posted", top: "USAA", candidates: ["USAA", "NEWA", "CNAA"] });
    expect(posts.map((p) => p.ticker)).toEqual(["USAA"]);
    expect(posts[0].body).toContain("#1 stock of the day: USAA (US Alpha)");
    expect(tables.chat_club_days[0].candidates).toHaveLength(3);
    const again = await runStockClubTick(db, new Date(NOW.getTime() + 15 * 60_000));
    expect(again.status).toBe("same");
    expect(posts).toHaveLength(1);
  });
  it("#403: once a day: a new #1 later in the day is ranked but not posted", async () => {
    await runStockClubTick(db, NOW);
    country("CNAA", "China");
    const next = await runStockClubTick(db, new Date(NOW.getTime() + 15 * 60_000));
    expect(next).toMatchObject({ status: "done_for_day", top: "CNAA", candidates: ["CNAA", "USAA", "NEWA"] });
    expect(posts.map((p) => p.ticker)).toEqual(["USAA"]);
  });
  it("with intraday updates on: re-ranks once a country is known, and an Asian stock takes #1 and posts", async () => {
    await runStockClubTick(db, NOW, { intraday: true });
    country("CNAA", "China");
    const next = await runStockClubTick(db, new Date(NOW.getTime() + 15 * 60_000), { intraday: true });
    expect(next).toMatchObject({ status: "posted", top: "CNAA", candidates: ["CNAA", "USAA", "NEWA"] });
    expect(posts.map((p) => p.ticker)).toEqual(["USAA", "CNAA"]);
  });
  it("with intraday updates on: never posts the same stock twice in a day, even when it's #1 again", async () => {
    await runStockClubTick(db, NOW, { intraday: true });
    country("CNAA", "China");
    await runStockClubTick(db, NOW, { intraday: true });
    snapshots = snapshots.filter((s) => s.ticker !== "CNAA");
    expect((await runStockClubTick(db, NOW, { intraday: true })).status).toBe("already_posted");
    expect(posts.map((p) => p.ticker)).toEqual(["USAA", "CNAA"]);
  });
  it("nothing passes, nothing posts", async () => {
    snapshots = snapshots.filter((s) => !["USAA", "NEWA", "CNAA"].includes(s.ticker));
    expect((await runStockClubTick(db, NOW)).status).toBe("none");
    expect(posts).toEqual([]);
  });
  it("an admin pick posts at once and stops automatic changes until resumed", async () => {
    await runStockClubTick(db, NOW);
    expect(await postAdminPick(db, "NEWA", NOW)).toMatchObject({ posted: true });
    country("CNAA", "China");
    expect((await runStockClubTick(db, NOW)).status).toBe("locked");
    expect(posts.map((p) => [p.ticker, p.source])).toEqual([["USAA", "auto"], ["NEWA", "admin"]]);
    expect(posts[1].body).toContain("Today's pick: NEWA");
    await resumeAutomatic(db, NOW);
    expect((await runStockClubTick(db, NOW)).status).toBe("done_for_day"); // once a day: the day already has its stock
    expect((await runStockClubTick(db, NOW, { intraday: true })).status).toBe("posted");
    expect(posts.map((p) => p.ticker)).toEqual(["USAA", "NEWA", "CNAA"]);
  });
  it("an admin pick needs a price", async () => {
    expect(await postAdminPick(db, "NOPE", NOW)).toEqual({ posted: false, reason: "no_quote" });
  });
  it("reads hour bars from 1130 days back and daily bars for the 200 SMA, and today's 2-minute bars", async () => {
    await runStockClubTick(db, NOW);
    const calls = aggs.mock.calls.map((c) => c.slice(0, 5));
    expect(calls).toEqual(expect.arrayContaining([
      ["USAA", 1, "hour", "2023-10-03", "2026-11-06"],
      ["USAA", 1, "day", "2025-12-21", "2026-11-06"],
      ["USAA", 2, "minute", "2026-11-06", "2026-11-06"],
    ]));
  });
});

// #403: a morning report version (one row per build or 15-minute refresh), first ticker = its #1.
const report = (sentDate: string, tickers: string[], createdAt: string, status = "success") =>
  tables.morning_email_archive.push({ sent_date: sentDate, status, created_at: createdAt, stocks_json: tickers.map((ticker) => ({ ticker })) });

describe("#403: the #1 follows today's Longboard morning report", () => {
  it("today's report #1 is posted even when the scan's rules drop it (over $20)", async () => {
    snapshots.push({ ticker: "OVER", changePct: 160, lastPrice: 21.4, volume: 7_000_000 });
    refs.OVER = { type: "CS", name: "Over Twenty", marketCap: 16e6 };
    report("2026-11-06", ["OVER", "NEWA"], "2026-11-06T13:34:00Z");
    const result = await runStockClubTick(db, NOW);
    expect(result).toMatchObject({ status: "posted", from: "report", top: "OVER", candidates: ["OVER", "USAA", "NEWA", "CNAA"] });
    expect(posts.map((p) => [p.ticker, p.source, p.data.from])).toEqual([["OVER", "auto", "report"]]);
    expect(posts[0].body).toContain("#1 stock of the day: OVER (Over Twenty)");
    expect(posts[0].data).toMatchObject({ price: 21.4, changePct: 160 });
  });
  it("a report #1 that also passes the scan is used as is, ahead of the country weighting", async () => {
    country("CNAA", "China");
    report("2026-11-06", ["NEWA"], "2026-11-06T13:34:00Z");
    expect(await runStockClubTick(db, NOW)).toMatchObject({ status: "posted", from: "report", top: "NEWA", candidates: ["NEWA", "CNAA", "USAA"] });
  });
  it("the newest successful version of today's report counts", async () => {
    report("2026-11-06", ["USAA"], "2026-11-06T13:34:00Z");
    report("2026-11-06", ["NEWA"], "2026-11-06T14:45:00Z");
    report("2026-11-06", ["CNAA"], "2026-11-06T14:50:00Z", "failed");
    expect(await readReportTop(db, "2026-11-06")).toBe("NEWA");
  });
  it("a report for an older day doesn't count: the scan and ranking pick, and the post says so", async () => {
    country("CNAA", "China");
    report("2026-11-05", ["USAA"], "2026-11-06T14:45:00Z"); // yesterday's report, still refreshing today
    expect(await runStockClubTick(db, NOW)).toMatchObject({ status: "posted", from: "scan", top: "CNAA" });
    expect(posts.map((p) => p.data.from)).toEqual(["scan"]);
  });
  it("the report's #1 is posted once; a later refresh with the same #1 posts nothing", async () => {
    report("2026-11-06", ["NEWA"], "2026-11-06T13:34:00Z");
    await runStockClubTick(db, NOW);
    report("2026-11-06", ["NEWA", "USAA"], "2026-11-06T15:00:00Z");
    expect((await runStockClubTick(db, new Date(NOW.getTime() + 15 * 60_000))).status).toBe("same");
    expect(posts.map((p) => p.ticker)).toEqual(["NEWA"]);
  });
  it("once a day: a report that arrives after the scan's pick doesn't post a second stock", async () => {
    expect(await runStockClubTick(db, NOW)).toMatchObject({ status: "posted", from: "scan", top: "USAA" }); // no report yet
    report("2026-11-06", ["NEWA"], "2026-11-06T15:05:00Z");
    expect(await runStockClubTick(db, NOW)).toMatchObject({ status: "done_for_day", from: "report", top: "NEWA" });
    expect(posts.map((p) => [p.ticker, p.data.from])).toEqual([["USAA", "scan"]]);
  });
  it("with intraday updates on: a later report takes over; a stock already posted never posts again", async () => {
    const tick = () => runStockClubTick(db, NOW, { intraday: true });
    expect(await tick()).toMatchObject({ from: "scan", top: "USAA" });
    report("2026-11-06", ["NEWA"], "2026-11-06T15:05:00Z");
    expect(await tick()).toMatchObject({ status: "posted", from: "report", top: "NEWA" });
    report("2026-11-06", ["USAA"], "2026-11-06T15:20:00Z");
    expect((await tick()).status).toBe("already_posted");
    expect(posts.map((p) => [p.ticker, p.data.from])).toEqual([["USAA", "scan"], ["NEWA", "report"]]);
  });
  it("an admin pick still stops automatic changes for the day", async () => {
    expect(await postAdminPick(db, "CNAA", NOW)).toMatchObject({ posted: true });
    report("2026-11-06", ["NEWA"], "2026-11-06T15:05:00Z");
    expect(await runStockClubTick(db, NOW)).toMatchObject({ status: "locked", from: "report", top: "NEWA" });
    expect(posts.map((p) => [p.ticker, p.source])).toEqual([["CNAA", "admin"]]);
  });
  it("before the open, the run waits for the report; once the report has a #1 it posts pre-market", async () => {
    const early = new Date("2026-11-06T12:30:00Z"); // 7:30 AM New York
    expect(await runStockClubTick(db, early)).toMatchObject({ status: "waiting_for_report", from: "scan", top: null });
    expect(posts).toEqual([]);
    report("2026-11-06", ["NEWA"], "2026-11-06T12:34:00Z");
    expect(await runStockClubTick(db, new Date("2026-11-06T12:45:00Z"))).toMatchObject({ status: "posted", from: "report", top: "NEWA" });
    expect(posts.map((p) => [p.ticker, p.data.from])).toEqual([["NEWA", "report"]]);
  });
  it("still no report: the scan waits out the morning window, then picks once (the fallback)", async () => {
    expect(await runStockClubTick(db, new Date("2026-11-06T14:45:00Z"))).toMatchObject({ status: "waiting_for_report" }); // 8:45 AM Central
    expect(await runStockClubTick(db, new Date("2026-11-06T15:00:00Z"))).toMatchObject({ status: "posted", from: "scan", top: "USAA" }); // 9:00
    country("CNAA", "China");
    expect(await runStockClubTick(db, new Date("2026-11-06T15:15:00Z"))).toMatchObject({ status: "done_for_day", top: "CNAA" });
    expect(posts.map((p) => p.ticker)).toEqual(["USAA"]);
  });
  it("a report #1 with no quote waits for the next run instead of posting the scan's #1", async () => {
    report("2026-11-06", ["GONE"], "2026-11-06T13:34:00Z");
    expect(await runStockClubTick(db, NOW)).toMatchObject({ status: "no_quote", from: "report", top: "GONE" });
    expect(posts).toEqual([]);
  });
});

describe("#403: the report posts its #1 the moment it's saved", () => {
  const AT_734_CT = new Date("2026-11-06T13:34:30Z"); // 8:34 AM New York, pre-market
  it("today's report: posts its #1 at once, pre-market, without a market scan", async () => {
    snapshots.push({ ticker: "OVER", changePct: 160, lastPrice: 19.08, volume: 5_800_000 });
    refs.OVER = { type: "CS", name: "Over Twenty", marketCap: 16e6 };
    report("2026-11-06", ["OVER", "NEWA"], "2026-11-06T13:34:00Z");
    expect(await postReportPick(db, AT_734_CT)).toMatchObject({ status: "posted", from: "report", top: "OVER" });
    expect(posts.map((p) => [p.ticker, p.source, p.data.from])).toEqual([["OVER", "auto", "report"]]);
  });
  it("an older day's report (a refresh of Friday's on Monday) never posts", async () => {
    report("2026-11-05", ["USAA"], "2026-11-06T12:00:00Z");
    expect(await postReportPick(db, AT_734_CT)).toMatchObject({ status: "none", top: null });
    expect(posts).toEqual([]);
  });
  it("in the morning window a new report #1 posts, never a stock posted already; after it, nothing changes", async () => {
    report("2026-11-06", ["NEWA"], "2026-11-06T13:34:00Z");
    await postReportPick(db, AT_734_CT);
    expect((await postReportPick(db, AT_734_CT)).status).toBe("same"); // a refresh, same #1
    report("2026-11-06", ["USAA"], "2026-11-06T13:45:00Z"); // the 7:45 CT rebuild has a new #1
    expect(await postReportPick(db, new Date("2026-11-06T13:47:00Z"))).toMatchObject({ status: "posted", top: "USAA" });
    report("2026-11-06", ["NEWA"], "2026-11-06T14:00:00Z"); // the #1 swings back
    expect((await postReportPick(db, new Date("2026-11-06T14:02:00Z"))).status).toBe("already_posted");
    report("2026-11-06", ["CNAA"], "2026-11-06T14:45:00Z"); // the 8:45 rebuild, saved at 8:52
    expect(await postReportPick(db, new Date("2026-11-06T14:52:00Z"))).toMatchObject({ status: "posted", top: "CNAA" });
    report("2026-11-06", ["THREE"], "2026-11-06T15:01:00Z"); // an admin's build by hand after the window
    expect((await postReportPick(db, new Date("2026-11-06T15:01:00Z"))).status).toBe("done_for_day");
    expect((await runStockClubTick(db, new Date("2026-11-06T15:15:00Z"))).status).toBe("done_for_day"); // the 15-minute run agrees
    expect(posts.map((p) => p.ticker)).toEqual(["NEWA", "USAA", "CNAA"]);
  });
  it("the 15-minute run also follows a new report #1 inside the window", async () => {
    report("2026-11-06", ["NEWA"], "2026-11-06T12:45:00Z");
    expect(await runStockClubTick(db, new Date("2026-11-06T13:00:00Z"))).toMatchObject({ status: "posted", top: "NEWA" });
    report("2026-11-06", ["CNAA"], "2026-11-06T13:15:00Z");
    expect(await runStockClubTick(db, new Date("2026-11-06T13:15:30Z"))).toMatchObject({ status: "posted", from: "report", top: "CNAA" });
  });
  it("an admin's pick locks the day against the report too", async () => {
    await postAdminPick(db, "CNAA", AT_734_CT);
    report("2026-11-06", ["NEWA"], "2026-11-06T13:40:00Z");
    expect((await postReportPick(db, AT_734_CT)).status).toBe("locked");
    expect(posts.map((p) => p.ticker)).toEqual(["CNAA"]);
  });
  it("not on a weekend or holiday", async () => {
    report("2026-11-07", ["NEWA"], "2026-11-07T13:40:00Z");
    expect((await postReportPick(db, new Date("2026-11-07T14:00:00Z"))).status).toBe("skipped");
    expect(posts).toEqual([]);
  });
});

describe("what the lookup program also gets", () => {
  it("candidates that never alerted in Gainers and still need facts, and borrow for the top three", async () => {
    await runStockClubTick(db, NOW);
    const got = await clubLookupNeeds(db, "2026-11-06", new Set(["NEWA"]), new Map(), NOW.getTime());
    expect(got.needs).toEqual([{ ticker: "CNAA", fields: ["country", "cash", "instOwn"] }]);
    expect(got.borrow.map((b) => b.ticker).sort()).toEqual(["CNAA", "USAA"]);
  });
  it("nothing extra without the club tables", async () => {
    const broken = { from: () => { throw new Error("relation does not exist"); } } as unknown as SupabaseClient;
    expect(await clubLookupNeeds(broken, "2026-11-06", new Set(), null)).toEqual({ needs: [], borrow: [] });
  });
});

describe("market hours", () => {
  it.each([
    ["2026-11-06T08:59:00Z", false], // 3:59 AM New York
    ["2026-11-06T09:00:00Z", true], // #403: 4:00 AM, pre-market
    ["2026-11-06T14:29:00Z", true], // 9:29 AM
    ["2026-11-06T14:30:00Z", true],
    ["2026-11-06T21:00:00Z", true], // 4:00 PM
    ["2026-11-06T21:15:00Z", false],
    ["2026-11-07T15:00:00Z", false], // Saturday
    ["2026-11-26T15:00:00Z", false], // Thanksgiving
    ["2026-07-06T13:45:00Z", true], // 9:45 AM in daylight saving time
    ["2026-07-06T07:59:00Z", false], // 3:59 AM in daylight saving time
  ])("%s → %s", (at, open) => expect(inClubWindow(new Date(at))).toBe(open));
  it.each([
    ["2026-11-06T14:59:00Z", false], // 8:59 AM Central
    ["2026-11-06T15:00:00Z", true], // 9:00, after the morning window
  ])("the scan may pick once the morning window is over: %s → %s", (at, open) => expect(scanFallbackOpen(new Date(at))).toBe(open));
});
