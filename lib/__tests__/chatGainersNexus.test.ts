import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NEXUS_RETRY_MS,
  NEXUS_TTL_MS,
  NEXUS_URL,
  NEXUS_WAIT_MS,
  gainersNexus,
  nexusWords,
  parseNexus,
  resetGainersNexus,
} from "@/lib/chatGainersNexus";

// #458: Short Check's operating-nexus feed for the Gainers Table's overseas marker (faked here; the
// real feed is never called).
const KEY = "test-only-short-check-key";
const AIMD = {
  ticker: "AIMD",
  overseas: true,
  countries: ["Taiwan", "Cayman Islands"],
  reason: "Listed in the US. Filings tie operations or control to Taiwan and the Cayman Islands.",
  evidenceUrl: "https://www.sec.gov/Archives/edgar/data/1/000000000000000000/aimd-10k.htm",
  asOf: "2026-11-10",
  status: "flagged",
};
const clear = (ticker: string) => ({ ticker, overseas: false, countries: [], reason: "No nexus.", evidenceUrl: null, asOf: "2026-11-10", status: "clear" });
const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fetchMock = vi.fn();
const asked = () => fetchMock.mock.calls.map(([url]) => String(url).slice(NEXUS_URL.length));

beforeEach(() => {
  resetGainersNexus();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("SHORT_CHECK_API_KEY", KEY);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("parseNexus (#458)", () => {
  it("reads a flagged answer: countries, reason, the SEC link and the date", () => {
    expect(parseNexus(AIMD, "AIMD")).toEqual({
      kind: "flagged",
      nexus: { countries: ["Taiwan", "Cayman Islands"], reason: AIMD.reason, evidenceUrl: AIMD.evidenceUrl, asOf: "2026-11-10" },
    });
  });
  it("is no marker for clear, not applicable and unknown", () => {
    expect(parseNexus(clear("USCO"), "USCO")).toEqual({ kind: "clear" });
    expect(parseNexus({ ...clear("USCO"), status: "not_applicable" }, "USCO")).toEqual({ kind: "clear" });
    expect(parseNexus({ ...AIMD, status: "unknown" }, "AIMD")).toEqual({ kind: "unknown" });
  });
  it("needs overseas true and at least one country to flag", () => {
    expect(parseNexus({ ...AIMD, overseas: false }, "AIMD").kind).toBe("unknown");
    expect(parseNexus({ ...AIMD, overseas: "yes" }, "AIMD").kind).toBe("unknown");
    expect(parseNexus({ ...AIMD, countries: [] }, "AIMD").kind).toBe("unknown");
    expect(parseNexus({ ...AIMD, countries: "Taiwan" }, "AIMD").kind).toBe("unknown");
    expect(parseNexus({ ...AIMD, countries: [42, "", "<b>x</b>"] }, "AIMD").kind).toBe("unknown");
  });
  it("refuses anything that isn't an answer for this ticker", () => {
    for (const bad of [null, undefined, "flagged", [AIMD], 7]) expect(parseNexus(bad, "AIMD").kind).toBe("unknown");
    expect(parseNexus(AIMD, "OTHR").kind).toBe("unknown");
  });
  it("keeps only an https sec.gov link, a real date and plain text", () => {
    const flagged = (extra: Record<string, unknown>) => {
      const result = parseNexus({ ...AIMD, ...extra }, "AIMD");
      if (result.kind !== "flagged") throw new Error("not flagged");
      return result.nexus;
    };
    for (const url of ["http://www.sec.gov/x", "https://evil.example/sec.gov", "https://sec.gov.evil.example/x", "javascript:alert(1)", 5])
      expect(flagged({ evidenceUrl: url }).evidenceUrl).toBeNull();
    expect(flagged({ evidenceUrl: "https://sec.gov/x" }).evidenceUrl).toBe("https://sec.gov/x");
    expect(flagged({ asOf: "2026-11-10T04:00:00Z" }).asOf).toBe("2026-11-10");
    expect(flagged({ asOf: "last week" }).asOf).toBeNull();
    expect(flagged({ reason: "<script>" }).reason).toBeNull();
    expect(flagged({ reason: "x".repeat(401) }).reason).toBeNull();
    expect(flagged({ countries: ["Taiwan", "Taiwan", " Cayman  Islands "] }).countries).toEqual(["Taiwan", "Cayman Islands"]);
  });
});

describe("nexusWords (#458)", () => {
  it("says where, why, when and who", () => {
    expect(nexusWords({ countries: ["Taiwan", "Cayman Islands"], reason: AIMD.reason, evidenceUrl: null, asOf: "2026-11-10" })).toBe(
      "Operates overseas: Taiwan, Cayman Islands. Listed in the US. Filings tie operations or control to Taiwan and the Cayman Islands (as of Nov 10, 2026). Source: Short Check",
    );
    expect(nexusWords({ countries: ["Taiwan"], reason: null, evidenceUrl: null, asOf: "2026-11-10" })).toBe(
      "Operates overseas: Taiwan. Checked (as of Nov 10, 2026). Source: Short Check",
    );
    expect(nexusWords({ countries: ["Taiwan"], reason: "Ops in Taiwan", evidenceUrl: null, asOf: null })).toBe(
      "Operates overseas: Taiwan. Ops in Taiwan. Source: Short Check",
    );
  });
});

describe("gainersNexus (#458)", () => {
  it("asks once a day per ticker, with the key in a header and never in the address", async () => {
    fetchMock.mockImplementation(async (url: string) => (String(url).endsWith("/AIMD") ? answer(AIMD) : answer(clear("USCO"))));
    const first = await gainersNexus(["AIMD", "USCO", "AIMD"]);
    expect([...first.keys()]).toEqual(["AIMD"]);
    expect(first.get("AIMD")?.countries).toEqual(["Taiwan", "Cayman Islands"]);
    expect(asked().sort()).toEqual(["AIMD", "USCO"]);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(String(url)).not.toContain(KEY);
      expect((init as RequestInit).headers).toMatchObject({ "x-api-key": KEY });
      expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
    }
    await gainersNexus(["AIMD", "USCO"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("asks again after a day, and a failed or unknown answer after an hour", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-11-15T14:00:00Z"), toFake: ["Date"] });
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith("/AIMD") ? answer(AIMD) : String(url).endsWith("/UNKN") ? answer({ ...AIMD, ticker: "UNKN", status: "unknown" }) : answer({ error: "x" }, 500),
    );
    await gainersNexus(["AIMD", "UNKN", "DOWN"]);
    vi.setSystemTime(Date.now() + NEXUS_RETRY_MS + 1);
    await gainersNexus(["AIMD", "UNKN", "DOWN"]);
    expect(asked().filter((t) => t === "AIMD")).toHaveLength(1);
    expect(asked().filter((t) => t === "UNKN")).toHaveLength(2);
    expect(asked().filter((t) => t === "DOWN")).toHaveLength(2);
    vi.setSystemTime(Date.now() + NEXUS_TTL_MS);
    const later = await gainersNexus(["AIMD"]);
    expect(asked().filter((t) => t === "AIMD")).toHaveLength(2);
    expect(later.has("AIMD")).toBe(true);
  });
  it("asks nothing without the key", async () => {
    vi.stubEnv("SHORT_CHECK_API_KEY", "");
    expect((await gainersNexus(["AIMD"])).size).toBe(0);
    vi.stubEnv("SHORT_CHECK_API_KEY", undefined as unknown as string);
    expect((await gainersNexus(["AIMD"])).size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("asks nothing for an empty list or a bad ticker", async () => {
    expect((await gainersNexus([])).size).toBe(0);
    expect((await gainersNexus(["../x", "a b"])).size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("is quiet when the feed refuses, limits, breaks or throws, and logs nothing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    fetchMock.mockImplementation(async (url: string) => {
      const t = String(url).slice(NEXUS_URL.length);
      if (t === "BADK") return answer({ error: "unauthorized" }, 401);
      if (t === "LIMT") return answer({ error: "rate_limited" }, 429);
      if (t === "NOTC") return answer({ error: "not_configured" }, 503);
      if (t === "HTML") return new Response("<html>oops</html>", { status: 200 });
      throw new TypeError(`fetch failed for ${KEY}`);
    });
    const found = await gainersNexus(["BADK", "LIMT", "NOTC", "HTML", "THRW"]);
    expect(found.size).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    for (const spy of [log, warn, info]) expect(spy).not.toHaveBeenCalled();
  });
  it("doesn't keep the table waiting on a slow answer; the late one fills the cache", async () => {
    vi.useFakeTimers();
    let finish: (value: Response) => void = () => {};
    fetchMock.mockImplementation((url: string) =>
      String(url).endsWith("/SLOW") ? new Promise<Response>((resolve) => (finish = resolve)) : Promise.resolve(answer(clear("FAST"))),
    );
    const first = gainersNexus(["SLOW", "FAST"]);
    await vi.advanceTimersByTimeAsync(NEXUS_WAIT_MS + 1);
    expect((await first).size).toBe(0);
    finish(answer({ ...AIMD, ticker: "SLOW" }));
    await vi.advanceTimersByTimeAsync(0);
    const second = await gainersNexus(["SLOW"]);
    expect(second.get("SLOW")?.countries).toEqual(["Taiwan", "Cayman Islands"]);
    expect(asked().filter((t) => t === "SLOW")).toHaveLength(1);
  });
  it("gives up on a request after its timeout (aborted: no marker)", async () => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      init.signal?.throwIfAborted();
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    expect((await gainersNexus(["AIMD"])).size).toBe(0);
  });
  it("asks only a few at a time", async () => {
    let running = 0;
    let most = 0;
    fetchMock.mockImplementation(async (url: string) => {
      running++;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
      return answer(clear(String(url).slice(NEXUS_URL.length)));
    });
    await gainersNexus(["AAAA", "BBBB", "CCCC", "DDDD", "EEEE", "FFFF", "GGGG", "HHHH", "IIII"]);
    expect(fetchMock).toHaveBeenCalledTimes(9);
    expect(most).toBeLessThanOrEqual(4);
  });
});
