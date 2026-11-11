import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SHARES_MISSING_TTL_MS, SHARES_TTL_MS, SHARES_WAIT_MS, gainersShares, resetGainersShares, sharesFromDetails } from "@/lib/chatGainersShares";

// #442: shares outstanding for the Gainers Table's Market Cap, from Polygon's ticker details (faked here).
const details = (results: Record<string, unknown> | undefined) => new Response(JSON.stringify({ status: "OK", results }), { status: 200 });
const fetchMock = vi.fn();
const asked = () => fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname);

beforeEach(() => {
  resetGainersShares();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("POLYGON_API_KEY", "test-only");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("sharesFromDetails (#442)", () => {
  it("uses the weighted count (the whole company), else the share class's", () => {
    expect(sharesFromDetails({ weighted_shares_outstanding: 5_870_000_000, share_class_shares_outstanding: 5_830_000_000 })).toBe(5_870_000_000);
    expect(sharesFromDetails({ share_class_shares_outstanding: 4_960_000 })).toBe(4_960_000);
    expect(sharesFromDetails({ weighted_shares_outstanding: 0, share_class_shares_outstanding: 4_960_000 })).toBe(4_960_000);
  });
  it("is null without a usable count", () => {
    for (const d of [null, undefined, {}, { weighted_shares_outstanding: "12" }, { weighted_shares_outstanding: -5 }, { share_class_shares_outstanding: Number.NaN }])
      expect(sharesFromDetails(d as never)).toBeNull();
  });
});

describe("gainersShares (#442)", () => {
  it("reads each ticker's details once a day, with the key in a header and never in the address", async () => {
    fetchMock.mockImplementation(async (url: string) => (String(url).endsWith("/AAA") ? details({ weighted_shares_outstanding: 4_960_000 }) : details({})));
    const first = await gainersShares(["AAA", "BBB", "AAA"]);
    expect([...first]).toEqual([["AAA", 4_960_000], ["BBB", null]]);
    expect(asked().sort()).toEqual(["/v3/reference/tickers/AAA", "/v3/reference/tickers/BBB"]);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(String(url)).not.toContain("test-only");
      expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer test-only" });
    }
    await gainersShares(["AAA", "BBB"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("asks again after a day, and a missing count after an hour", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-11-11T14:00:00Z") });
    fetchMock.mockImplementation(async (url: string) => (String(url).endsWith("/AAA") ? details({ weighted_shares_outstanding: 1e6 }) : details(undefined)));
    await gainersShares(["AAA", "BBB"]);
    vi.setSystemTime(Date.now() + SHARES_MISSING_TTL_MS + 1);
    await gainersShares(["AAA", "BBB"]);
    expect(asked().filter((p) => p.endsWith("/BBB"))).toHaveLength(2);
    expect(asked().filter((p) => p.endsWith("/AAA"))).toHaveLength(1);
    vi.setSystemTime(Date.now() + SHARES_TTL_MS);
    await gainersShares(["AAA"]);
    expect(asked().filter((p) => p.endsWith("/AAA"))).toHaveLength(2);
  });
  it("gives null for a failed read and doesn't keep the table waiting on a slow one", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith("/DOWN") ? new Response("nope", { status: 500 }) : new Promise<Response>(() => {}),
    );
    const read = gainersShares(["DOWN", "SLOW"]);
    await vi.advanceTimersByTimeAsync(SHARES_WAIT_MS + 1);
    expect([...(await read)]).toEqual([["DOWN", null], ["SLOW", null]]);
  });
  it("is null for every ticker without a key, never throwing", async () => {
    vi.stubEnv("POLYGON_API_KEY", "");
    expect([...(await gainersShares(["AAA"]))]).toEqual([["AAA", null]]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
