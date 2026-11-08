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
  const rows = () => tables[table].filter((row) => filters.every(([op, k, v]) => (op === "eq" ? row[k] === v : (v as unknown[]).includes(row[k]))));
  const q = {
    select: () => q,
    eq: (k: string, v: unknown) => (filters.push(["eq", k, v]), q),
    in: (k: string, v: unknown[]) => (filters.push(["in", k, v]), q),
    order: () => q,
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
let posts: { ticker: string; source: string; body: string }[];
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
    posts.push({ ticker: args.p_ticker as string, source: args.p_source as string, body: args.p_body as string });
    return { data: { posted: true, messageId: id }, error: null };
  },
} as unknown as SupabaseClient;

const { runStockClubTick, postAdminPick, resumeAutomatic, clubLookupNeeds, inClubWindow } = await import("@/lib/stockClubServer");
const NOW = new Date("2026-11-06T15:00:00Z"); // 10:00 AM New York, a Friday.
const country = (ticker: string, value: string | null) =>
  tables.chat_gainers_facts.push({ ticker, country: value, country_checked_at: value ? "2026-11-06T14:00:00Z" : null, inst_own_pct: "5.5", inst_own_checked_at: "2026-11-06T14:00:00Z", cash_checked_at: "2026-11-06T14:00:00Z", not_found: false, checked_at: "2026-11-06T14:00:00Z" });

beforeEach(() => {
  tables = { chat_club_days: [], chat_club_picks: [], chat_gainers_facts: [], chat_gainers_borrow: [] };
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
  it("re-ranks once a country is known: an Asian stock takes #1 and posts", async () => {
    await runStockClubTick(db, NOW);
    country("CNAA", "China");
    const next = await runStockClubTick(db, new Date(NOW.getTime() + 15 * 60_000));
    expect(next).toMatchObject({ status: "posted", top: "CNAA", candidates: ["CNAA", "USAA", "NEWA"] });
    expect(posts.map((p) => p.ticker)).toEqual(["USAA", "CNAA"]);
  });
  it("never posts the same stock twice in a day, even when it's #1 again", async () => {
    await runStockClubTick(db, NOW);
    country("CNAA", "China");
    await runStockClubTick(db, NOW);
    snapshots = snapshots.filter((s) => s.ticker !== "CNAA");
    expect((await runStockClubTick(db, NOW)).status).toBe("already_posted");
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
    expect((await runStockClubTick(db, NOW)).status).toBe("posted");
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
    ["2026-11-06T14:29:00Z", false], // 9:29 AM New York
    ["2026-11-06T14:30:00Z", true],
    ["2026-11-06T21:00:00Z", true], // 4:00 PM
    ["2026-11-06T21:15:00Z", false],
    ["2026-11-07T15:00:00Z", false], // Saturday
    ["2026-11-26T15:00:00Z", false], // Thanksgiving
    ["2026-07-06T13:45:00Z", true], // 9:45 AM in daylight saving time
  ])("%s → %s", (at, open) => expect(inClubWindow(new Date(at))).toBe(open));
});
