import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DT_API_BUSY_BACKOFF_MS, DT_API_KEY_BACKOFF_MS, apiCash, apiFacts, createDtApi } from "../../scripts/gainers-lookup/dt-api.mjs";
import { BrowserDown } from "../../scripts/gainers-lookup/dt-tab.mjs";
import { BROWSER_WAIT_MS, createLookup, createPacer, readDtKey, waitAfterRound } from "../../scripts/gainers-lookup/lookup.mjs";
import { DT_NEWS_EXPRESSION, factsPayload } from "../../scripts/gainers-lookup/parse.mjs";
import { parseGainersFacts } from "../chatGainersFacts";

// #534: company facts from the DilutionTracker API. A fake fetch and a fake key: no network, no real
// key, no browser (the tab is a small stand-in with dt-tab.mjs's ready/navigate/evaluate).

const KEY = "fake-dt-key-0123456789abcdef";
type Answer = { status: number; body?: unknown } | Error;
type Company = { profile?: Answer; cash?: Answer; inst?: Answer; float?: Answer };

const ok = (body: unknown): Answer => ({ status: 200, body });
const none: Answer = { status: 404, body: { type: "https://api.dilutiontracker.com/problems/data-unavailable", title: "Data Unavailable", status: 404 } };
const invalid: Answer = { status: 400, body: { type: "https://api.dilutiontracker.com/problems/invalid-ticker", title: "Invalid Ticker", status: 400 } };
const WETO: Company = {
  profile: ok({ cik: "1941158", symbol: "WETO", companyName: "Webus International", country: "China", inDtCoverage: true }),
  cash: ok({ ticker: "WETO", hasEstCurrentCash: true, estCurrentCash: 16.89, monthsCashRunway: 65.79, quarterlyOperatingCashflow: -0.77, lastReportedCash: 0.08 }),
  inst: ok({ ticker: "WETO", cik: "1941158", effectiveDate: "2026/9/30", totalInstOwnPct: 0.1 }),
  float: ok({ ticker: "WETO", float: 14.74 }),
};

function fakeApi(companies: Record<string, Company>) {
  const calls: string[] = [];
  const keys = new Set<string>();
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);
    keys.add(String((init?.headers as Record<string, string>)?.["x-api-key"]));
    const ticker = path.split("/").pop() ?? "";
    const company = companies[ticker];
    const answer: Answer = !company
      ? path.includes("/profile/")
        ? invalid
        : none
      : ((path.includes("/profile/") ? company.profile : path.includes("/cash-position/") ? company.cash : path.includes("/institutional-ownership/") ? company.inst : company.float) ?? none);
    if (answer instanceof Error) throw answer;
    return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { fetch, calls, keys };
}

describe("#534 DilutionTracker API facts: the mapping", () => {
  it("maps a normal company to the page parser's shape, and the chat's route accepts it", () => {
    const parsed = apiFacts({
      profile: { country: "China" },
      cash: { hasEstCurrentCash: true, estCurrentCash: 16.89, monthsCashRunway: 65.79, quarterlyOperatingCashflow: -0.77 },
      inst: { totalInstOwnPct: 0.1 },
      float: { float: 14.74 },
    });
    expect(parsed).toEqual({ state: "found", country: "China", instOwnPct: 0.1, floatShares: 14_740_000, cashUsd: 16_890_000, cashMonthsLeft: 65.79, cashFlowPositive: false, cashSection: true });
    expect(parseGainersFacts(factsPayload("WETO", parsed))).toEqual({ ticker: "WETO", notFound: false, country: "China", cashUsd: 16_890_000, cashMonthsLeft: 65.79, cashFlowPositive: false, instOwnPct: 0.1, floatShares: 14_740_000 });
  });

  it("writes the U.S. the way the page parser does, and an empty country as none", () => {
    for (const raw of ["U.S", "US", "USA", "United States"]) expect(apiFacts({ profile: { country: raw } }).country).toBe("U.S.");
    for (const raw of ["", "  ", "N/A", null, undefined, 7]) expect(apiFacts({ profile: { country: raw } }).country).toBeNull();
    expect(apiFacts({ profile: { country: " Hong  Kong " } }).country).toBe("Hong Kong");
  });

  it("a cash-flow-positive company keeps its cash and has no months", () => {
    expect(apiCash({ hasEstCurrentCash: true, estCurrentCash: 49.36, monthsCashRunway: 100, quarterlyOperatingCashflow: 0.15 })).toEqual({ cashUsd: 49_360_000, cashMonthsLeft: null, cashFlowPositive: true, cashSection: true });
    expect(apiCash({ hasEstCurrentCash: true, estCurrentCash: 2, monthsCashRunway: 100, quarterlyOperatingCashflow: 0 }).cashFlowPositive).toBe(true);
  });

  it("works out the real months when the API's figure is at its cap of 100", () => {
    expect(apiCash({ hasEstCurrentCash: true, estCurrentCash: 42.59, monthsCashRunway: 100, quarterlyOperatingCashflow: -0.26 }).cashMonthsLeft).toBe(491.4);
    // Under the cap the API's own figure stands (16.89 / 0.77 x 3 = 65.8, the API says 65.79).
    expect(apiCash({ hasEstCurrentCash: true, estCurrentCash: 16.89, monthsCashRunway: 65.79, quarterlyOperatingCashflow: -0.77 }).cashMonthsLeft).toBe(65.79);
    // A burn close to nothing never goes past what the chat accepts.
    expect(apiCash({ hasEstCurrentCash: true, estCurrentCash: 900, monthsCashRunway: 100, quarterlyOperatingCashflow: -0.000001 }).cashMonthsLeft).toBe(1e6);
    // At the cap with no burn figure to work from: 100 stands.
    expect(apiCash({ hasEstCurrentCash: true, estCurrentCash: 5, monthsCashRunway: 100, quarterlyOperatingCashflow: null })).toMatchObject({ cashMonthsLeft: 100, cashFlowPositive: false });
  });

  it("saves a company estimated to be out of cash as 0 cash and 0 months, never negative", () => {
    const out = apiCash({ hasEstCurrentCash: true, estCurrentCash: -0.37, monthsCashRunway: -0.29, quarterlyOperatingCashflow: -3.8 });
    expect(out).toEqual({ cashUsd: 0, cashMonthsLeft: 0, cashFlowPositive: false, cashSection: true });
    expect(parseGainersFacts(factsPayload("OUT", { ...apiFacts({ profile: { country: "U.S" } }), ...out }))).not.toBeNull();
  });

  it("leaves cash, float and institutional ownership empty when the API has none", () => {
    const empty = { state: "found", country: "U.S.", instOwnPct: null, floatShares: null, cashUsd: null, cashMonthsLeft: null, cashFlowPositive: false, cashSection: false };
    expect(apiFacts({ profile: { country: "U.S" }, cash: null, inst: null, float: null })).toEqual(empty);
    expect(apiFacts({ profile: { country: "U.S" }, cash: { hasEstCurrentCash: false, estCurrentCash: 3, quarterlyOperatingCashflow: 1 }, inst: { totalInstOwnPct: "64.5" }, float: { float: 0 } })).toEqual(empty);
    expect(apiFacts({ profile: { country: "U.S" }, inst: { totalInstOwnPct: 1000.5 }, float: { float: -2 } })).toEqual(empty);
    expect(apiFacts({ profile: { country: "U.S" }, inst: { totalInstOwnPct: 64.5 }, float: { float: 0.55 } })).toMatchObject({ instOwnPct: 64.5, floatShares: 550_000 });
  });
});

describe("#534 DilutionTracker API client", () => {
  it("asks the four addresses for a ticker, with the key in the header only", async () => {
    const { fetch, calls, keys } = fakeApi({ WETO });
    const api = createDtApi({ key: KEY, fetch });
    const result = await api.facts("WETO");
    expect(result).toMatchObject({ ok: true, parsed: { state: "found", country: "China", cashUsd: 16_890_000, cashMonthsLeft: 65.79, instOwnPct: 0.1, floatShares: 14_740_000 } });
    expect([...calls].sort()).toEqual(["/v2/cash-position/WETO", "/v2/company/profile/WETO", "/v2/float/WETO", "/v2/institutional-ownership/companies/WETO"]);
    expect([...keys]).toEqual([KEY]);
    expect(calls.join(" ")).not.toContain(KEY);
  });

  it("404 on cash, float and institutional ownership is a found company with those empty", async () => {
    const { fetch } = fakeApi({ AAPL: { profile: ok({ symbol: "AAPL", country: "U.S" }) } });
    const result = await createDtApi({ key: KEY, fetch }).facts("AAPL");
    expect(result).toEqual({ ok: true, parsed: { state: "found", country: "U.S.", instOwnPct: null, floatShares: null, cashUsd: null, cashMonthsLeft: null, cashFlowPositive: false, cashSection: false } });
  });

  it("an invalid ticker is 'not on DilutionTracker', with one request", async () => {
    const { fetch, calls } = fakeApi({});
    const result = await createDtApi({ key: KEY, fetch }).facts("ZZZZ");
    expect(result).toMatchObject({ ok: true, parsed: { state: "not_found" } });
    expect(factsPayload("ZZZZ", (result as { parsed: Parameters<typeof factsPayload>[1] }).parsed)).toMatchObject({ ticker: "ZZZZ", notFound: true });
    expect(calls).toEqual(["/v2/company/profile/ZZZZ"]);
  });

  it("never asks about a ticker that doesn't fit the API", async () => {
    const { fetch, calls } = fakeApi({});
    const api = createDtApi({ key: KEY, fetch });
    expect(api.fits("BRK.B")).toBe(false);
    expect(api.fits("TOOLONG")).toBe(false);
    expect(api.fits("WETO")).toBe(true);
    expect(await api.facts("BRK.B")).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
  });

  it("a failed read after a good profile fails the whole try: no half-read facts", async () => {
    const { fetch } = fakeApi({ WETO: { ...WETO, float: { status: 503 } } });
    const lines: string[] = [];
    const clock = { now: 1_000_000 };
    const api = createDtApi({ key: KEY, fetch, now: () => clock.now, say: (line) => lines.push(line) });
    expect(await api.facts("WETO")).toEqual({ ok: false, reason: "the API answered 503" });
    expect(lines).toEqual(["DilutionTracker API answered 503; using the browser tab for facts for 3 minutes"]);
    expect(api.available(clock.now + DT_API_BUSY_BACKOFF_MS - 1)).toBe(false);
    expect(api.available(clock.now + DT_API_BUSY_BACKOFF_MS)).toBe(true);
  });

  it("stops asking for 30 minutes after a refused key, 3 after a rate limit or network trouble; says each once; the key is in no message", async () => {
    for (const [answer, ms, said] of [
      [{ status: 401 }, DT_API_KEY_BACKOFF_MS, "DilutionTracker API refused the key (401); using the browser tab for facts for 30 minutes"],
      [{ status: 403 }, DT_API_KEY_BACKOFF_MS, "DilutionTracker API refused the key (403); using the browser tab for facts for 30 minutes"],
      [{ status: 429 }, DT_API_BUSY_BACKOFF_MS, "DilutionTracker API rate limit reached (429); using the browser tab for facts for 3 minutes"],
      [new Error(`connect failed for x-api-key ${KEY}`), DT_API_BUSY_BACKOFF_MS, "DilutionTracker API network error (connect failed for x-api-key [key]); using the browser tab for facts for 3 minutes"],
      [Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }), DT_API_BUSY_BACKOFF_MS, "DilutionTracker API timed out; using the browser tab for facts for 3 minutes"],
    ] as Array<[Answer, number, string]>) {
      const { fetch } = fakeApi({ WETO: { profile: answer }, NEXT: { profile: answer } });
      const lines: string[] = [];
      const clock = { now: 5_000_000 };
      const api = createDtApi({ key: KEY, fetch, now: () => clock.now, say: (line) => lines.push(line) });
      const first = await api.facts("WETO");
      const second = await api.facts("NEXT");
      expect(first.ok || second.ok).toBe(false);
      expect(lines).toEqual([said]);
      expect(JSON.stringify([first, second, lines])).not.toContain(KEY);
      expect(api.available(clock.now + ms - 1)).toBe(false);
      expect(api.available(clock.now + ms)).toBe(true);
    }
    expect(DT_API_KEY_BACKOFF_MS).toBe(30 * 60_000);
    expect(DT_API_BUSY_BACKOFF_MS).toBe(3 * 60_000);
  });

  it("has no packages and never prints the key", () => {
    const source = readFileSync("scripts/gainers-lookup/dt-api.mjs", "utf8");
    expect(source.match(/^import .*$/gm)).toEqual(['import { normaliseCountry } from "./parse.mjs";']);
    expect(source).not.toMatch(/console\.|say\([^)]*\bkey\b/);
  });
});

// --- the lookup round, with a stand-in for the one tab

const pageText = (ticker: string) =>
  `DilutionTracker\nSector:IndustrialsIndustry:Building ProductsCountry:Greece Exchange:NASDAQ\n` +
  `Mkt Cap & EV:193.7M / 165.8MFloat & OS:0.55M / 16.46MEst. Net Cash/Sh:1.7Inst Own:2.5%SI:41.7%\n` +
  `Cash Position\n\nThe company has 30.7 months of cash left based on quarterly cash burn of -$0.31M and estimated current cash of $31.5M.\n\n12/31/2018\nMillions of USD\nWarrant\n${ticker}`;
const nyNow = () => new Date().toLocaleString("en-US", { timeZone: "America/New_York" });

function fakeTab({ down = false } = {}) {
  const state = { down, navigations: [] as string[], ready: 0, url: "https://dilutiontracker.com/", mark: null as string | null };
  const downMessage = "DilutionTracker browser not running on 9333";
  const check = () => {
    if (state.down) throw new BrowserDown(downMessage);
  };
  return {
    state,
    downMessage,
    async ready() {
      state.ready++;
      check();
    },
    async navigate(url: string) {
      check();
      state.navigations.push(url);
      state.url = url;
      state.mark = null;
    },
    async evaluate(expression: string) {
      check();
      const ticker = decodeURIComponent(state.url.split("/").pop() ?? "");
      if (expression.startsWith("window.__lbGainersLookup = ")) return (state.mark = JSON.parse(expression.slice("window.__lbGainersLookup = ".length)));
      if (expression === DT_NEWS_EXPRESSION)
        return { active: true, headings: ["PR Releases"], rows: [{ meta: ["1 hour ago", `${nyNow()} `, "ACCESS Newswire"], links: [{ href: `https://dilution.news/${ticker.toLowerCase()}0001`, text: `${ticker} announces something` }] }] };
      return state.mark === null ? pageText(ticker) : null;
    },
    disconnect() {},
    targetId: () => "T1",
  };
}

const TIMING = { pollMs: 5, newsPollMs: 5, pageTimeoutMs: 300, cashWaitMs: 50, newsWaitMs: 500 };
type Post = Record<string, unknown>;

function setup({ companies = { WETO } as Record<string, Company>, key = KEY as string | null, down = false, failPosts = 0 } = {}) {
  const lines: string[] = [];
  const posts: Post[] = [];
  const clock = { now: Date.parse("2026-11-20T14:00:00Z") }; // 9 AM New York
  const net = fakeApi(companies);
  const tab = fakeTab({ down });
  const paced: number[] = [];
  const pacer = createPacer({ gap: 0 });
  const waits: number[] = [];
  let failing = failPosts;
  const api = key ? createDtApi({ key, fetch: net.fetch, now: () => clock.now, say: (line) => lines.push(line) }) : null;
  const lookup = createLookup({
    tab: tab as unknown as NonNullable<Parameters<typeof createLookup>[0]>["tab"],
    api,
    post: async (body: Post) => {
      if (failing-- > 0) throw new Error("chat answered 503");
      posts.push(body);
      return { saved: Array.isArray(body.items) ? body.items.length : true };
    },
    say: (line: string) => lines.push(line),
    pacer: { wait: (now: number) => pacer.wait(now), started: (now: number) => (paced.push(now), pacer.started(now)) },
    wait: async (ms: number) => void waits.push(ms),
    now: () => clock.now,
    timing: TIMING,
  });
  return { lookup, lines, posts, clock, net, tab, paced, waits };
}
const list = (needs: string[], news: string[] = []) => ({ tickers: [...new Set([...needs, ...news])], needs: needs.map((ticker) => ({ ticker })), news: news.map((ticker) => ({ ticker })) });
const factsPosts = (posts: Post[]) => posts.filter((p) => p.kind === undefined);

describe("#534 the lookup round with the API", () => {
  it("posts a new ticker's facts from the API without loading a page or using up the page limits", async () => {
    const { lookup, lines, posts, net, tab, paced } = setup();
    await lookup.round(list([]));
    const result = await lookup.round(list(["WETO"]));
    expect(result).toMatchObject({ browserDown: false, looked: 0, api: true, byApi: 1 });
    expect(posts).toEqual([{ ticker: "WETO", notFound: false, country: "China", cashUsd: 16_890_000, cashMonthsLeft: 65.79, cashFlowPositive: false, instOwnPct: 0.1, floatShares: 14_740_000 }]);
    expect(lines.at(-1)).toBe("WETO: (API) country China, cash 16890000, months 65.79, inst 0.1%, float 14740000");
    expect(tab.state.navigations).toEqual([]);
    expect(tab.state.ready).toBe(0); // the browser wasn't even asked
    expect(paced).toEqual([]);
    expect(net.calls).toHaveLength(4);
    // Once per day: still listed, it is never asked again.
    for (let i = 0; i < 3; i++) await lookup.round(list(["WETO"]));
    expect(net.calls).toHaveLength(4);
    expect(posts).toHaveLength(1);
  });

  it("never looks up the tickers already on the list at start, by API or by page", async () => {
    const { lookup, posts, net, tab, clock } = setup();
    await lookup.round(list(["WETO"], ["WETO"]));
    for (let i = 0; i < 3; i++) {
      await lookup.round(list(["WETO"], ["WETO"]));
      clock.now += 30 * 60_000;
    }
    expect(net.calls).toEqual([]);
    expect(tab.state.navigations).toEqual([]);
    expect(posts).toEqual([]);
  });

  it("posts 'not on DilutionTracker' for a ticker the API doesn't know", async () => {
    const { lookup, lines, posts, tab } = setup({ companies: {} });
    await lookup.round(list([]));
    await lookup.round(list(["ZZZZ"]));
    expect(posts).toEqual([{ ticker: "ZZZZ", notFound: true, country: null, cashUsd: null, cashMonthsLeft: null, cashFlowPositive: false, instOwnPct: null }]);
    expect(lines.at(-1)).toBe("ZZZZ: (API) not on DilutionTracker");
    expect(tab.state.navigations).toEqual([]);
  });

  it("falls back to the page when the API is down, and leaves the API alone for 3 minutes", async () => {
    const { lookup, lines, posts, net, tab, clock } = setup({ companies: { WETO: { profile: { status: 500 } }, NEXT: { profile: { status: 500 } } } });
    await lookup.round(list([]));
    const result = await lookup.round(list(["WETO", "NEXT"]));
    expect(result).toMatchObject({ browserDown: false, looked: 2, byApi: 0 });
    expect(net.calls).toEqual(["/v2/company/profile/WETO"]); // NEXT wasn't asked once the API was known down
    expect(tab.state.navigations).toEqual(["https://dilutiontracker.com/app/search/WETO", "https://dilutiontracker.com/app/search/NEXT"]);
    expect(factsPosts(posts)).toEqual([
      { ticker: "WETO", notFound: false, country: "Greece", cashUsd: 31_500_000, cashMonthsLeft: 30.7, cashFlowPositive: false, instOwnPct: 2.5, floatShares: 550_000 },
      { ticker: "NEXT", notFound: false, country: "Greece", cashUsd: 31_500_000, cashMonthsLeft: 30.7, cashFlowPositive: false, instOwnPct: 2.5, floatShares: 550_000 },
    ]);
    expect(lines).toContain("DilutionTracker API answered 500; using the browser tab for facts for 3 minutes");
    expect(lines).toContain("WETO: (API) no answer: the API answered 500; reading its page in the browser tab instead");
    expect(lines).toContain("WETO: (tab) country Greece, cash 31500000, months 30.7, inst 2.5%, float 550000");
    // Two minutes on a new ticker goes straight to the page; after three the API is asked again.
    clock.now += 2 * 60_000;
    await lookup.round(list(["WETO", "NEXT", "MIDA"]));
    expect(net.calls).toHaveLength(1);
    expect(tab.state.navigations).toHaveLength(3);
    clock.now += 60_000;
    await lookup.round(list(["WETO", "NEXT", "MIDA", "LATE"]));
    expect(net.calls).toEqual(["/v2/company/profile/WETO", "/v2/company/profile/LATE"]);
  });

  it("reads a ticker the API doesn't take (BRK.B) from the page", async () => {
    const { lookup, posts, net, tab } = setup();
    await lookup.round(list([]));
    await lookup.round(list(["BRK.B"]));
    expect(net.calls).toEqual([]);
    expect(tab.state.navigations).toEqual(["https://dilutiontracker.com/app/search/BRK.B"]);
    expect(factsPosts(posts).map((p) => p.ticker)).toEqual(["BRK.B"]);
  });

  it("still posts facts from the API when the browser is down, at the normal pace, saying so once", async () => {
    const { lookup, lines, posts, tab, clock } = setup({ companies: { WETO, NEWB: WETO }, down: true });
    await lookup.round(list([]));
    const first = await lookup.round(list(["WETO"], ["WETO"]));
    expect(first).toMatchObject({ browserDown: true, api: true, byApi: 1 });
    expect(waitAfterRound(first, true)).toBe(20_000);
    expect(waitAfterRound({ browserDown: true }, true)).toBe(BROWSER_WAIT_MS); // without the API: as before
    expect(factsPosts(posts).map((p) => p.ticker)).toEqual(["WETO"]);
    // The next ticker's facts arrive too; the browser is tried again only every 2 minutes.
    clock.now += 20_000;
    expect(await lookup.round(list(["WETO", "NEWB"], ["WETO", "NEWB"]))).toMatchObject({ browserDown: true, byApi: 1 });
    expect(factsPosts(posts).map((p) => p.ticker)).toEqual(["WETO", "NEWB"]);
    expect(tab.state.ready).toBe(1);
    expect(lines.filter((l) => l.includes("not running"))).toEqual(["DilutionTracker browser not running on 9333; checking again every 2 minutes"]);
    // The browser comes back: the news reads waiting for it go through the tab; facts aren't read again.
    tab.state.down = false;
    clock.now += BROWSER_WAIT_MS;
    expect(await lookup.round(list(["WETO", "NEWB"], ["WETO", "NEWB"]))).toMatchObject({ browserDown: false, looked: 2 });
    expect(lines).toContain("DilutionTracker browser answering again; using its one DilutionTracker tab");
    expect(posts.filter((p) => p.kind === "news").map((p) => p.ticker)).toEqual(["WETO", "NEWB"]);
    expect(factsPosts(posts)).toHaveLength(2);
  });

  it("reads the news through the tab once a day, with the facts from the API", async () => {
    const { lookup, posts, net, tab, clock, paced } = setup();
    await lookup.round(list([]));
    await lookup.round(list(["WETO"], ["WETO"]));
    expect(tab.state.navigations).toEqual(["https://dilutiontracker.com/app/search/WETO"]);
    expect(paced).toHaveLength(1);
    expect(factsPosts(posts)).toHaveLength(1);
    expect(factsPosts(posts)[0]).toMatchObject({ ticker: "WETO", country: "China" }); // the API's answer, not the page's
    expect(posts.filter((p) => p.kind === "news")).toMatchObject([{ ticker: "WETO", items: [{ title: "WETO announces something", source: "ACCESS Newswire" }] }]);
    for (let i = 0; i < 3; i++) {
      clock.now += 60 * 60_000;
      await lookup.round(list(["WETO"], ["WETO"]));
    }
    expect(tab.state.navigations).toHaveLength(1);
    expect(net.calls).toHaveLength(4);
    expect(posts).toHaveLength(2);
  });

  it("without a key reads everything from the tab, exactly as before", async () => {
    const { lookup, lines, posts, net, tab } = setup({ key: null });
    await lookup.round(list([]));
    const result = await lookup.round(list(["WETO"], ["WETO"]));
    expect(result).toEqual({ browserDown: false, looked: 1 });
    expect(net.calls).toEqual([]);
    expect(tab.state.navigations).toEqual(["https://dilutiontracker.com/app/search/WETO"]);
    expect(factsPosts(posts)).toMatchObject([{ ticker: "WETO", country: "Greece", floatShares: 550_000 }]);
    expect(lines).toContain("WETO: country Greece, cash 31500000, months 30.7, inst 2.5%, float 550000");
  });

  it("tries a ticker again after 5 minutes when the chat didn't save the API's answer", async () => {
    const { lookup, lines, posts, net, tab, clock } = setup({ failPosts: 1 });
    await lookup.round(list([]));
    await lookup.round(list(["WETO"]));
    expect(posts).toEqual([]);
    expect(lines.at(-1)).toBe("WETO: lookup failed: chat answered 503 (try 1)");
    clock.now += 4 * 60_000;
    await lookup.round(list(["WETO"]));
    expect(net.calls).toHaveLength(4);
    clock.now += 60_000;
    await lookup.round(list(["WETO"]));
    expect(net.calls).toHaveLength(8);
    expect(posts).toHaveLength(1);
    expect(tab.state.navigations).toEqual([]);
  });

  it("asks one ticker at a time, half a second apart", async () => {
    const { lookup, net, waits } = setup({ companies: { AAA: WETO, BBB: WETO, CCC: WETO } });
    await lookup.round(list([]));
    await lookup.round(list(["AAA", "BBB", "CCC"]));
    expect(waits).toEqual([500, 500]);
    expect(net.calls.map((c) => c.split("/").pop())).toEqual([...Array(4).fill("AAA"), ...Array(4).fill("BBB"), ...Array(4).fill("CCC")]);
  });

  it("never puts the key in a log line or a post", async () => {
    const companies: Record<string, Company> = {
      WETO,
      DENY: { profile: { status: 401 } },
      DOWN: { profile: new Error(`getaddrinfo failed (x-api-key: ${KEY})`) },
    };
    for (const tickers of [["WETO", "DOWN"], ["DENY"], ["ZZZZ", "BRK.B"]]) {
      const { lookup, lines, posts, net } = setup({ companies });
      await lookup.round(list([]));
      await lookup.round(list(tickers, tickers));
      expect(lines.length).toBeGreaterThan(1);
      expect(JSON.stringify([lines, posts, net.calls])).not.toContain(KEY);
    }
  });
});

describe("#534 the key file", () => {
  it("reads the key trimmed; a missing, empty or readable-by-others file means the browser tab", () => {
    const dir = mkdtempSync(join(tmpdir(), "lb-dt-key-"));
    const file = join(dir, "dilutiontracker.key");
    const none = { problem: "no DilutionTracker API key; using the browser tab for facts" };
    expect(readDtKey(file)).toEqual(none);
    writeFileSync(file, `  ${KEY}\n`, { mode: 0o600 });
    expect(readDtKey(file)).toEqual({ key: KEY });
    writeFileSync(file, "\n");
    expect(readDtKey(file)).toEqual(none);
    writeFileSync(file, `${KEY}\n`);
    chmodSync(file, 0o644);
    const open = readDtKey(file);
    expect(open.key).toBeUndefined();
    expect(open.problem).toMatch(/must be private \(chmod 600\)/);
    expect(open.problem).not.toContain(KEY);
  });
});
