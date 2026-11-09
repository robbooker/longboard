import { describe, it, expect } from "vitest";
import { buildNewsFeed, filterNews, newItemIds, newsItem, relativeTime, type PolygonArticle } from "../chatNews";

const at = (minutesAgo: number) => new Date(Date.parse("2026-11-08T15:00:00Z") - minutesAgo * 60_000).toISOString();
const article = (id: string, minutesAgo: number, tickers: string[] = [], extra: Partial<PolygonArticle> = {}): PolygonArticle => ({
  id,
  title: `Story ${id}`,
  article_url: `https://news.example/${id}`,
  published_utc: at(minutesAgo),
  tickers,
  publisher: { name: "Example Wire" },
  description: `About ${id}`,
  ...extra,
});

describe("news item mapping", () => {
  it("keeps the fields the feed shows and marks gainer stories", () => {
    expect(newsItem(article("a", 4, ["ABCD", "SPY"]), new Set(["ABCD"]))).toEqual({
      id: "a",
      publishedAt: at(4),
      title: "Story a",
      source: "Example Wire",
      url: "https://news.example/a",
      tickers: ["ABCD", "SPY"],
      description: "About a",
      gainer: true,
      origin: "polygon",
    });
  });
  it("drops articles without an id, a title, a time or an http(s) link", () => {
    expect(newsItem(article("a", 1, [], { id: "" }))).toBeNull();
    expect(newsItem(article("a", 1, [], { title: "  " }))).toBeNull();
    expect(newsItem(article("a", 1, [], { published_utc: "soon" }))).toBeNull();
    expect(newsItem(article("a", 1, [], { article_url: "javascript:alert(1)" }))).toBeNull();
    expect(newsItem(article("a", 1, [], { article_url: 42 }))).toBeNull();
    expect(newsItem(null as unknown as PolygonArticle)).toBeNull();
  });
  it("cleans up text and odd tickers, treats a missing summary as empty and a missing publisher as the site", () => {
    const item = newsItem(article("a", 1, ["ABCD", "ABCD", "bad", 7 as unknown as string, "BRK.B"], { title: " Big\n news ", description: "", publisher: null }))!;
    expect(item.title).toBe("Big news");
    expect(item.tickers).toEqual(["ABCD", "BRK.B"]);
    expect(item.description).toBeNull();
    expect(item.source).toBe("news.example");
    expect(item.gainer).toBe(false);
  });
});

describe("building the feed", () => {
  it("puts the gainers' headlines first, then the market's, each newest first", () => {
    const feed = buildNewsFeed(
      [article("g-old", 90, ["ABCD"]), article("g-new", 5, ["WXYZ"])],
      [article("m-new", 1), article("m-old", 30), article("m-names-gainer", 10, ["ABCD"])],
      ["ABCD", "WXYZ"],
    );
    expect(feed.map((i) => i.id)).toEqual(["g-new", "m-names-gainer", "g-old", "m-new", "m-old"]);
  });
  it("shows an article read twice once", () => {
    const feed = buildNewsFeed([article("x", 5, ["ABCD", "WXYZ"]), article("x", 5, ["ABCD", "WXYZ"])], [article("x", 5, ["ABCD", "WXYZ"])], ["ABCD"]);
    expect(feed).toHaveLength(1);
  });
  it("caps the list", () => {
    const market = Array.from({ length: 150 }, (_, i) => article(`m${i}`, i));
    const feed = buildNewsFeed([], market, []);
    expect(feed).toHaveLength(100);
    expect(feed[0].id).toBe("m0");
    expect(buildNewsFeed([], market, [], 3)).toHaveLength(3);
  });
});

describe("feed helpers", () => {
  const now = Date.parse("2026-11-08T15:00:00Z");
  it("writes short relative times", () => {
    expect(relativeTime(at(0), now)).toBe("now");
    expect(relativeTime(at(4), now)).toBe("4m");
    expect(relativeTime(at(125), now)).toBe("2h");
    expect(relativeTime(at(60 * 50), now)).toBe("2d");
    expect(relativeTime(new Date(now + 60_000).toISOString(), now)).toBe("now");
  });
  it("counts what's new and filters by gainers or one ticker", () => {
    const feed = buildNewsFeed([article("g", 2, ["ABCD"])], [article("m", 1, ["SPY"])], ["ABCD"]);
    expect(newItemIds(feed.slice(1), feed)).toEqual(["g"]);
    expect(filterNews(feed, "all")).toHaveLength(2);
    expect(filterNews(feed, "gainers").map((i) => i.id)).toEqual(["g"]);
    expect(filterNews(feed, { ticker: "SPY" }).map((i) => i.id)).toEqual(["m"]);
  });
});
