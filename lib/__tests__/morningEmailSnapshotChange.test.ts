// #403: before the open Polygon's snapshot can carry today's price and volume while
// todaysChangePerc is still exactly 0 (and lastTrade is missing). The scan works the % out from the
// price and the previous close instead, so the 5:30 AM CT morning build sees the morning's movers.
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSingleSnapshot } from "@/lib/morning-email/polygon";

const serve = (ticker: Record<string, unknown>) =>
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ticker }), { status: 200 })));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("snapshot % change", () => {
  it("a pre-market 0 is worked out from the price and the previous close", async () => {
    vi.stubEnv("POLYGON_API_KEY", "test");
    // OMH at 6:30 AM New York on Nov 9: 15.5 against a 7.36 close, 1.6M shares, Polygon said 0%.
    serve({ ticker: "OMH", todaysChangePerc: 0, todaysChange: 0, day: { c: 15.5, v: 1_600_000 }, prevDay: { c: 7.36 } });
    const snap = await fetchSingleSnapshot("OMH");
    expect(snap?.lastPrice).toBe(15.5);
    expect(snap?.volume).toBe(1_600_000);
    expect(snap?.changePct).toBeCloseTo(110.6, 1);
    expect(snap?.dollarChange).toBeCloseTo(8.14, 2);
  });
  it("Polygon's own % is kept when it has one", async () => {
    vi.stubEnv("POLYGON_API_KEY", "test");
    serve({ ticker: "CKX", todaysChangePerc: 87.17, todaysChange: 9.04, day: { c: 19.41, v: 7_670_065 }, prevDay: { c: 10.37 }, lastTrade: { p: 19.41, t: 1 } });
    expect(await fetchSingleSnapshot("CKX")).toMatchObject({ changePct: 87.17, dollarChange: 9.04, lastPrice: 19.41 });
  });
  it("no day bar yet: the last trade is the price", async () => {
    vi.stubEnv("POLYGON_API_KEY", "test");
    serve({ ticker: "AAAA", todaysChangePerc: 0, day: { c: 0, v: 0 }, prevDay: { c: 2 }, lastTrade: { p: 3, t: 1 } });
    expect(await fetchSingleSnapshot("AAAA")).toMatchObject({ lastPrice: 3, changePct: 50 });
  });
  it("a stock that really is flat stays at 0", async () => {
    vi.stubEnv("POLYGON_API_KEY", "test");
    serve({ ticker: "FLAT", todaysChangePerc: 0, day: { c: 2, v: 10 }, prevDay: { c: 2 } });
    expect((await fetchSingleSnapshot("FLAT"))?.changePct).toBe(0);
  });
});
