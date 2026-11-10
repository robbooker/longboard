import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QUOTE_TTL_MS, QUOTE_WAIT_MS, gainersQuotes, quoteFromSnapshot, resetGainersQuotes } from "@/lib/chatGainersQuotes";
import { changeLabel, changeTone, priceLabel, volumeLabel } from "@/lib/chatGainersFacts";

const ok = (tickers: unknown[]) => new Response(JSON.stringify({ status: "OK", tickers }), { status: 200 });
const snap = (ticker: string, extra: Record<string, unknown> = {}) => ({
  ticker,
  todaysChangePerc: 42.15,
  lastTrade: { p: 2.5 },
  min: { c: 2.49, av: 1_234_567, v: 5_000 },
  day: { c: 2.4, v: 900_000 },
  ...extra,
});
const fetchMock = vi.fn();
const urls = () => fetchMock.mock.calls.map(([url]) => new URL(String(url)));

beforeEach(() => {
  resetGainersQuotes();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("POLYGON_API_KEY", "test-only");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("quoteFromSnapshot (#372)", () => {
  it("takes the latest trade, Polygon's % today and the day's accumulated volume", () => {
    expect(quoteFromSnapshot(snap("AEHL"))).toEqual({ price: 2.5, changePct: 42.15, volume: 1_234_567 });
  });
  it("counts pre-market volume: min.av when day.v is still 0", () => {
    expect(quoteFromSnapshot(snap("AEHL", { day: { c: 0, v: 0 } })).volume).toBe(1_234_567);
  });
  it("keeps day.v once it is the larger total", () => {
    expect(quoteFromSnapshot(snap("AEHL", { day: { c: 2.4, v: 5_000_000 } })).volume).toBe(5_000_000);
  });
  it("falls back from the last trade to the minute close, then the day close", () => {
    expect(quoteFromSnapshot(snap("A", { lastTrade: undefined })).price).toBe(2.49);
    expect(quoteFromSnapshot(snap("A", { lastTrade: { p: 0 }, min: { c: 0 } })).price).toBe(2.4);
    expect(quoteFromSnapshot({ ticker: "A" })).toEqual({ price: null, changePct: null, volume: null });
  });
  it("#412: reads an after-hours snapshot (extended trade, no minute bar) without breaking", () => {
    expect(quoteFromSnapshot({ ticker: "TANH", lastTrade: { p: 3.1 }, day: { c: 2.2, v: 900_000 }, todaysChangePerc: 61.4 })).toEqual({ price: 3.1, changePct: 61.4, volume: 900_000 });
    expect(quoteFromSnapshot({ ticker: "TANH", lastTrade: {}, min: {}, day: { c: 2.2, v: 0 } })).toEqual({ price: 2.2, changePct: null, volume: null });
  });
  it("#417: works out % today from the price and the previous close when Polygon sends 0 or nothing", () => {
    // Pre-market 2026-11-10: no last trade, todaysChangePerc 0, but min.c and prevDay.c both present.
    const pepg = { ticker: "PEPG", todaysChangePerc: 0, lastTrade: { p: 0 }, min: { c: 5.108, av: 15_769_221 }, day: { c: 5.104, v: 15_772_039 }, prevDay: { c: 2.39 } };
    expect(quoteFromSnapshot(pepg).price).toBe(5.108);
    expect(quoteFromSnapshot(pepg).changePct).toBeCloseTo(113.72, 1);
    expect(quoteFromSnapshot({ ticker: "RUBI", min: { c: 1.425 }, prevDay: { c: 1.84 } }).changePct).toBeCloseTo(-22.55, 1);
  });
  it("#430: % today is the price against the previous close; Polygon's figure is only the fallback", () => {
    expect(quoteFromSnapshot({ ticker: "CECO", todaysChangePerc: 2.46, lastTrade: { p: 53.2789 }, min: { c: 52.03 }, prevDay: { c: 52 } }).changePct).toBeCloseTo(2.459, 2);
    expect(quoteFromSnapshot({ ticker: "FLAT", todaysChangePerc: 0, lastTrade: { p: 4 }, prevDay: { c: 4 } }).changePct).toBe(0);
    expect(quoteFromSnapshot({ ticker: "NEW", todaysChangePerc: 0, lastTrade: { p: 4 }, prevDay: { c: 0 } }).changePct).toBe(0);
    expect(quoteFromSnapshot({ ticker: "NOPREV", todaysChangePerc: 7.5, lastTrade: { p: 4 } }).changePct).toBe(7.5);
    expect(quoteFromSnapshot({ ticker: "NONE", prevDay: { c: 3 } }).changePct).toBeNull();
  });
  it("#430: after hours the minute bar is newer than the last trade, so it gives the price and the %", () => {
    // Polygon at 4:23 PM New York on 2026-11-10. FOSL's last trade is from 3:59:57 PM; it then jumped after hours.
    const fosl = { ticker: "FOSL", todaysChangePerc: -1.985111662531019, lastTrade: { p: 7.9, t: 1794344397000000000 }, min: { c: 9.987, av: 978_512, t: 1794345720000 }, day: { c: 7.902, v: 978_512 }, prevDay: { c: 8.06 } };
    expect(quoteFromSnapshot(fosl).price).toBe(9.987);
    expect(quoteFromSnapshot(fosl).changePct).toBeCloseTo(23.91, 1);
    // A stock that ran in regular hours keeps its whole gain after the close (not just the after-hours move).
    const zip = { ticker: "ZIP", todaysChangePerc: 51.515151515151516, lastTrade: { p: 6.5, t: 1794344771000000000 }, min: { c: 6.628, t: 1794345720000 }, day: { c: 6.568 }, prevDay: { c: 4.29 } };
    expect(quoteFromSnapshot(zip).price).toBe(6.628);
    expect(quoteFromSnapshot(zip).changePct).toBeCloseTo(54.5, 1);
  });
  it("#430: in regular hours a last trade newer than the minute bar still gives the price", () => {
    const live = { ticker: "LIVE", lastTrade: { p: 3.3, t: 1794330065000000000 }, min: { c: 3.2, t: 1794329940000 }, prevDay: { c: 3 } };
    expect(quoteFromSnapshot(live).price).toBe(3.3);
    expect(quoteFromSnapshot(live).changePct).toBeCloseTo(10, 5);
    // A last trade inside the latest minute bar: the bar's close is that trade or a later one.
    expect(quoteFromSnapshot({ ...live, lastTrade: { p: 3.3, t: 1794329950000000000 } }).price).toBe(3.2);
  });
});

describe("gainersQuotes (#372)", () => {
  it("asks for every ticker in one request, with the key in a header", async () => {
    fetchMock.mockResolvedValueOnce(ok([snap("AEHL"), snap("BRK.B", { lastTrade: { p: 0.4512 } })]));
    const quotes = await gainersQuotes(["AEHL", "BRK.B", "GONE", "AEHL"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = urls();
    expect(url.pathname).toBe("/v2/snapshot/locale/us/markets/stocks/tickers");
    expect(url.searchParams.get("tickers")).toBe("AEHL,BRK.B,GONE");
    expect(url.search).not.toContain("test-only");
    expect(quotes.get("AEHL")).toEqual({ price: 2.5, changePct: 42.15, volume: 1_234_567 });
    expect(quotes.get("BRK.B")?.price).toBe(0.4512);
    expect(quotes.get("GONE")).toBeNull();
  });

  it("reads Polygon at most once per ticker per 15 seconds, however many viewers ask", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    fetchMock.mockImplementation(async () => ok([snap("AEHL"), snap("NEWT")]));
    await Promise.all([gainersQuotes(["AEHL", "NEWT"]), gainersQuotes(["AEHL", "NEWT"])]);
    now += QUOTE_TTL_MS - 1;
    await gainersQuotes(["NEWT", "AEHL"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // A new ticker alone is fetched alone.
    await gainersQuotes(["AEHL", "NEWT", "FRSH"]);
    expect(urls()[1].searchParams.get("tickers")).toBe("FRSH");
    now += 2;
    await gainersQuotes(["AEHL", "NEWT", "FRSH"]);
    expect(urls()[2].searchParams.get("tickers")).toBe("AEHL,NEWT");
  });

  it("splits a long list into requests of 100", async () => {
    fetchMock.mockImplementation(async () => ok([]));
    const tickers = Array.from({ length: 150 }, (_, i) => `T${i}`);
    await gainersQuotes(tickers);
    expect(urls().map((u) => u.searchParams.get("tickers")!.split(",").length)).toEqual([100, 50]);
  });

  it("gives null quotes, not an error, when Polygon fails or there is no key", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    expect((await gainersQuotes(["AEHL"])).get("AEHL")).toBeNull();
    resetGainersQuotes();
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect((await gainersQuotes(["AEHL"])).get("AEHL")).toBeNull();
    resetGainersQuotes();
    vi.stubEnv("POLYGON_API_KEY", "");
    expect((await gainersQuotes(["AEHL"])).get("AEHL")).toBeNull();
  });

  it("answers without prices when Polygon is slow, and fills in on the next read", async () => {
    vi.useFakeTimers();
    let answer: (r: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => (answer = resolve)));
    const first = gainersQuotes(["AEHL"]);
    await vi.advanceTimersByTimeAsync(QUOTE_WAIT_MS);
    expect((await first).get("AEHL")).toBeNull();
    answer(ok([snap("AEHL")]));
    await vi.advanceTimersByTimeAsync(0);
    expect((await gainersQuotes(["AEHL"])).get("AEHL")?.price).toBe(2.5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("price, % today and volume labels (#372)", () => {
  const q = (price: number | null, changePct: number | null = null, volume: number | null = null) => ({ price, changePct, volume });
  it("shows prices with cents, four decimals under $1", () => {
    expect(priceLabel(q(1.23))).toBe("$1.23");
    expect(priceLabel(q(12))).toBe("$12.00");
    expect(priceLabel(q(1234.5))).toBe("$1,234.50");
    expect(priceLabel(q(0.45123))).toBe("$0.4512");
    expect(priceLabel(q(0.00005))).toBe("$0.0001");
    expect(priceLabel(q(null))).toBe("—");
    expect(priceLabel(null)).toBe("—");
  });
  it("shows % today signed to one decimal, coloured by direction", () => {
    expect(changeLabel(q(1, 123.44))).toBe("+123.4%");
    expect(changeLabel(q(1, 1234.56))).toBe("+1,234.6%");
    expect(changeLabel(q(1, -5.25))).toBe("-5.3%");
    expect(changeLabel(q(1, -0.04))).toBe("0.0%");
    expect(changeLabel(q(1, null))).toBe("—");
    expect(changeLabel(undefined)).toBe("—");
    expect(changeTone(q(1, 12))).toBe("up");
    expect(changeTone(q(1, -12))).toBe("down");
    expect(changeTone(q(1, 0.01))).toBeNull();
    expect(changeTone(null)).toBeNull();
  });
  it("shows volume short", () => {
    expect(volumeLabel(q(1, 1, 12_345_678))).toBe("12.3M");
    expect(volumeLabel(q(1, 1, 850_000))).toBe("850K");
    expect(volumeLabel(q(1, 1, 150_400))).toBe("150K");
    expect(volumeLabel(q(1, 1, 9_550))).toBe("9.6K");
    expect(volumeLabel(q(1, 1, 999_960))).toBe("1M");
    expect(volumeLabel(q(1, 1, 1_250_000_000))).toBe("1.3B");
    expect(volumeLabel(q(1, 1, 940))).toBe("940");
    expect(volumeLabel(q(1, 1, 0))).toBe("0");
    expect(volumeLabel(q(1, 1, null))).toBe("—");
  });
});
