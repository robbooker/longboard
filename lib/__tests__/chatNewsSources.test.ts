import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dtItem, filterNews, fmpItem, fmpTime, headlineKey, mergeNewsFeed, newItemIds, sourceName, type DtNewsRow, type FmpArticle, type PolygonArticle } from "../chatNews";
import { readFmpNews, resetFmpCache, FMP_TTL_MS } from "../chatNewsFmp";

// #387: DilutionTracker's releases, Polygon and FMP in one feed. Synthetic stories only.
const NOW = Date.parse("2026-11-08T15:00:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const dt = (ticker: string, key: string, minutes: number, title = `DT ${key}`, source = "ACCESS Newswire"): DtNewsRow => ({
  ticker,
  item_key: `dt:${key}`,
  published_at: ago(minutes),
  source,
  title,
  url: `https://dilution.news/${key}`,
});
const poly = (id: string, minutes: number, tickers: string[] = [], extra: Partial<PolygonArticle> = {}): PolygonArticle => ({
  id,
  title: `Polygon ${id}`,
  article_url: `https://news.example/${id}`,
  published_utc: ago(minutes),
  tickers,
  publisher: { name: "Benzinga" },
  ...extra,
});
// FMP's times are New York wall-clock: 15:00Z is 10:00 in New York on Nov 8 (EST).
const nyClock = (minutes: number) => {
  const d = new Date(NOW - 5 * 3_600_000 - minutes * 60_000);
  return d.toISOString().slice(0, 19).replace("T", " ");
};
const fmp = (n: number, minutes: number, extra: Partial<FmpArticle> = {}): FmpArticle => ({
  symbol: "None",
  publishedDate: nyClock(minutes),
  publisher: "Fox Business",
  site: "foxbusiness.com",
  title: `FMP story ${n}`,
  url: `https://www.foxbusiness.com/story-${n}`,
  ...extra,
});
const ids = (items: { id: string }[]) => items.map((i) => i.id);

describe("publisher names", () => {
  it("names a source by its site first, then tidies the name it gave", () => {
    expect(sourceName("GlobeNewsWire", "https://www.globenewswire.com/news-release/1")).toBe("GlobeNewswire");
    expect(sourceName("GlobeNewswire Inc.", "https://example.com/a")).toBe("GlobeNewswire");
    expect(sourceName("Barrons", "https://www.barrons.com/articles/x")).toBe("Barron's");
    expect(sourceName("Barrons", "https://elsewhere.example/x")).toBe("Barron's");
    expect(sourceName("Fox Business", "https://www.youtube.com/watch?v=1")).toBe("Fox Business");
    expect(sourceName("", "https://www.accessnewswire.com/newsroom/x")).toBe("ACCESS Newswire");
    expect(sourceName("https://odd.example", "https://www.odd.example/x")).toBe("odd.example");
    expect(sourceName("", "https://finance.yahoo.com/news/x")).toBe("Yahoo Finance");
  });
});

describe("FMP items", () => {
  it("reads FMP's New York times (EST and EDT) and times with a zone", () => {
    expect(new Date(fmpTime("2026-10-01 16:08:00")).toISOString()).toBe("2026-10-01T20:08:00.000Z");
    expect(new Date(fmpTime("2026-11-08 10:00:00")).toISOString()).toBe("2026-11-08T15:00:00.000Z");
    expect(new Date(fmpTime("2026-11-08T15:00:00Z")).toISOString()).toBe("2026-11-08T15:00:00.000Z");
    expect(fmpTime("yesterday")).toBeNaN();
    expect(fmpTime(5)).toBeNaN();
  });
  it("maps an article, with its stocks and a cleaned publisher, never as a gainer item", () => {
    const item = fmpItem(fmp(1, 30, { symbol: "BRK-A", publisher: "New York Post", url: "https://nypost.com/x" }))!;
    expect(item).toMatchObject({ title: "FMP story 1", source: "New York Post", url: "https://nypost.com/x", tickers: ["BRK-A"], gainer: false, origin: "fmp", publishedAt: ago(30), description: null });
    expect(item.id).toMatch(/^fmp-/);
    expect(fmpItem(fmp(2, 1))!.tickers).toEqual([]);
  });
  it("drops law-firm alerts, bad links and missing times", () => {
    expect(fmpItem(fmp(1, 1, { title: "SHAREHOLDER ALERT: investors who lost money" }))).toBeNull();
    expect(fmpItem(fmp(1, 1, { url: "javascript:alert(1)" }))).toBeNull();
    expect(fmpItem(fmp(1, 1, { publishedDate: "" }))).toBeNull();
    expect(fmpItem(null as unknown as FmpArticle)).toBeNull();
  });
});

describe("DilutionTracker items", () => {
  it("maps a saved release as a gainer item with its wire, older past three days, gone past thirty", () => {
    expect(dtItem(dt("SMX", "a1", 60), NOW)).toMatchObject({ tickers: ["SMX"], source: "ACCESS Newswire", gainer: true, origin: "dt", url: "https://dilution.news/a1" });
    expect(dtItem(dt("SMX", "a1", 60), NOW)!.older).toBeUndefined();
    expect(dtItem(dt("SMX", "a2", 5 * 1440), NOW)!.older).toBe(true);
    expect(dtItem(dt("SMX", "a3", 31 * 1440), NOW)).toBeNull();
    expect(dtItem({ ...dt("SMX", "a4", 1), url: "javascript:x" }, NOW)).toBeNull();
    expect(dtItem({ ticker: "SMX" }, NOW)).toBeNull();
  });
});

describe("merging the three sources", () => {
  const gainers = ["SMX", "WXYZ"];
  it("puts gainer news (DilutionTracker and Polygon) first, then Polygon and FMP market news, each newest first", () => {
    const feed = mergeNewsFeed({
      dtRows: [dt("SMX", "s1", 120), dt("SMX", "s2", 10), dt("NOTG", "x", 5)],
      gainerArticles: [poly("p-w", 30, ["WXYZ"])],
      marketArticles: [poly("p-m", 3, ["SPY"])],
      fmpArticles: [fmp(1, 1), fmp(2, 50)],
      gainers,
      now: NOW,
    });
    expect(feed.map((i) => [i.origin, i.title])).toEqual([
      ["dt", "DT s2"],
      ["polygon", "Polygon p-w"],
      ["dt", "DT s1"],
      ["fmp", "FMP story 1"],
      ["polygon", "Polygon p-m"],
      ["fmp", "FMP story 2"],
    ]);
  });
  it("shows a story once across sources: same headline, a stock in common, close in time", () => {
    const title = "SMX Announces Effective Date of Reverse Stock Split";
    const feed = mergeNewsFeed({
      dtRows: [dt("SMX", "rs", 60, title)],
      gainerArticles: [poly("p1", 58, ["SMX"], { title: "SMX announces effective date of reverse stock-split!", description: "From Polygon" })],
      marketArticles: [poly("p2", 20, [], { title: "Market story" })],
      fmpArticles: [fmp(1, 19, { title: "Market Story" }), fmp(2, 20, { title: title, symbol: "SMX" })],
      gainers,
      now: NOW,
    });
    expect(feed.map((i) => [i.origin, i.title])).toEqual([
      ["dt", title],
      ["polygon", "Market story"],
    ]);
    // The kept copy takes the other's summary; its wire's name stays DilutionTracker's.
    expect(feed[0]).toMatchObject({ source: "ACCESS Newswire", description: "From Polygon" });
  });
  it("keeps same-headline stories apart when they're for different stocks or far apart in time", () => {
    const feed = mergeNewsFeed({
      dtRows: [dt("SMX", "q1", 60, "Quarterly results"), dt("WXYZ", "q2", 60, "Quarterly results"), dt("SMX", "q3", 60 * 30, "Quarterly results")],
      gainers,
      now: NOW,
    });
    expect(feed).toHaveLength(3);
    expect(headlineKey("SMX's “Made in America”  &amp; more!")).toBe("smx s made in america more");
  });
  it("sends older releases after the default list; only a stock's own chip shows them", () => {
    const feed = mergeNewsFeed({ dtRows: [dt("SMX", "new", 30), dt("SMX", "old", 6 * 1440), dt("WXYZ", "wold", 10 * 1440)], marketArticles: [poly("m", 5)], gainers, now: NOW });
    expect(feed.map((i) => [i.title, !!i.older])).toEqual([
      ["DT new", false],
      ["Polygon m", false],
      ["DT old", true],
      ["DT wold", true],
    ]);
    expect(ids(filterNews(feed, "all"))).toEqual(ids(feed.slice(0, 2)));
    expect(filterNews(feed, "gainers").map((i) => i.title)).toEqual(["DT new"]);
    expect(filterNews(feed, { ticker: "SMX" }).map((i) => i.title)).toEqual(["DT new", "DT old"]);
    // An older release never counts toward "N new".
    expect(newItemIds([], feed)).toEqual(ids(feed.slice(0, 2)));
  });
  it("caps the default list but still sends the older releases", () => {
    const feed = mergeNewsFeed({ marketArticles: Array.from({ length: 150 }, (_, i) => poly(`m${i}`, i)), dtRows: [dt("SMX", "old", 6 * 1440)], gainers, now: NOW });
    expect(feed.filter((i) => !i.older)).toHaveLength(100);
    expect(feed.at(-1)!.title).toBe("DT old");
  });
});

describe("FMP reads", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    resetFmpCache();
    vi.stubEnv("FMP_API_KEY", "fmp-test-key-not-real");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  const stub = (handler: (path: string) => Response) => {
    fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.hostname !== "financialmodelingprep.com") throw new Error(`unexpected ${url}`);
      return handler(url.pathname);
    });
    vi.stubGlobal("fetch", fetchMock);
  };
  it("reads general and stock news with the key in a header, keeps the last day, and caches a minute", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    stub((path) => Response.json(path.endsWith("general-latest") ? [fmp(1, 5), fmp(9, 60 * 30)] : [fmp(2, 7, { symbol: "NVDA" })]));
    const read = await readFmpNews(NOW);
    expect(read).toMatchObject({ configured: true, okReads: 2, reads: 2 });
    expect(read.articles.map((a) => a.title)).toEqual(["FMP story 1", "FMP story 2"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/stable/news/");
    expect(String(url)).not.toContain("fmp-test-key-not-real");
    expect(init.headers.apikey).toBe("fmp-test-key-not-real");
    await readFmpNews(NOW + 1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.setSystemTime(NOW + FMP_TTL_MS + 1);
    await readFmpNews(NOW + FMP_TTL_MS + 1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it("carries on when FMP fails or answers oddly", async () => {
    stub((path) => (path.endsWith("general-latest") ? new Response("nope", { status: 500 }) : Response.json({ error: "limit" })));
    expect(await readFmpNews(NOW)).toMatchObject({ configured: true, okReads: 0, reads: 2, articles: [] });
    resetFmpCache();
    stub(() => {
      throw new Error("network");
    });
    expect(await readFmpNews(NOW)).toMatchObject({ okReads: 0, articles: [] });
  });
  it("reads nothing without a key", async () => {
    stub(() => Response.json([]));
    vi.stubEnv("FMP_API_KEY", "");
    expect(await readFmpNews(NOW)).toEqual({ configured: false, okReads: 0, reads: 0, articles: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
