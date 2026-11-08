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
