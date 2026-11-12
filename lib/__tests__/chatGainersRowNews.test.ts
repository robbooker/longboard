import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const { auth, admin } = vi.hoisted(() => ({ auth: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: auth }));
vi.mock("@/lib/chatAdmin", () => ({ createChatAdminClient: admin }));
import { GET } from "@/app/api/chat/gainers/news/route";
import {
  ROW_NEWS_EMPTY,
  ROW_NEWS_MAX,
  parseRowNewsData,
  rowNewsItems,
  rowNewsSince,
  rowNewsTicker,
  rowNewsTime,
} from "@/lib/chatGainersRowNews";

// #437: a Gainers Table row's press releases (DilutionTracker's saved releases only; synthetic rows).
const NOW = Date.parse("2026-11-11T17:00:00Z"); // 12:00 PM in New York
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const DAY = 24 * 60;
const release = (key: string, minutes: number, title: string, ticker = "SMX", source = "ACCESS Newswire") => ({
  ticker,
  item_key: `dt:${key}`,
  published_at: ago(minutes),
  source,
  title,
  url: `https://dilution.news/${key}`,
});

describe("rowNewsItems (#437)", () => {
  it("lists one ticker's releases from the last 30 days, newest first, each once", () => {
    const rows = [
      release("old1", 31 * DAY, "Too old"),
      release("b", 3 * DAY, "Second"),
      release("a", 30, "First"),
      release("a", 30, "First"),
      release("x", 10, "Other stock", "AEHL"),
      { ...release("bad", 5, "Bad link"), url: "javascript:alert(1)" },
      { ...release("blank", 5, "  ") },
      { ...release("c", 29 * DAY, "  Third   headline "), source: null },
    ];
    expect(rowNewsItems(rows, "SMX", NOW)).toEqual([
      { key: "dt:a", title: "First", url: "https://dilution.news/a", source: "ACCESS Newswire", publishedAt: ago(30) },
      { key: "dt:b", title: "Second", url: "https://dilution.news/b", source: "ACCESS Newswire", publishedAt: ago(3 * DAY) },
      { key: "dt:c", title: "Third headline", url: "https://dilution.news/c", source: "", publishedAt: ago(29 * DAY) },
    ]);
  });
  it("is empty for no rows or a bad answer, and keeps at most ROW_NEWS_MAX", () => {
    expect(rowNewsItems([], "SMX", NOW)).toEqual([]);
    expect(rowNewsItems(null, "SMX", NOW)).toEqual([]);
    const many = Array.from({ length: ROW_NEWS_MAX + 5 }, (_, i) => release(`k${i}`, i + 1, `T${i}`));
    const items = rowNewsItems(many, "SMX", NOW);
    expect(items).toHaveLength(ROW_NEWS_MAX);
    expect(items[0].title).toBe("T0");
  });
  it("checks the ticker asked for", () => {
    expect(rowNewsTicker("smx")).toBe("SMX");
    expect(rowNewsTicker("BRK.B")).toBe("BRK.B");
    expect(rowNewsTicker("1ABC")).toBeNull();
    expect(rowNewsTicker("")).toBeNull();
    expect(rowNewsTicker(null)).toBeNull();
    expect(rowNewsTicker("A'; drop")).toBeNull();
  });
  it("says when, in New York time: the time today, the date before", () => {
    expect(rowNewsTime("2026-11-11T12:02:00Z", NOW)).toBe("7:02 AM ET");
    expect(rowNewsTime("2026-11-09T21:30:00Z", NOW)).toBe("Nov 9, 4:30 PM ET");
  });
  it("has the exact empty words", () => {
    expect(ROW_NEWS_EMPTY).toBe("No press releases in the last 30 days.");
  });
  it("checks the route's answer in the page", () => {
    const item = { key: "dt:a", title: "First", url: "https://dilution.news/a", source: "GlobeNewswire", publishedAt: ago(5) };
    expect(parseRowNewsData({ ticker: "SMX", items: [item, { ...item, url: "data:x" }] }, "SMX")).toEqual([item]);
    expect(parseRowNewsData({ ticker: "AEHL", items: [item] }, "SMX")).toBeNull();
    expect(parseRowNewsData({ error: "news_unavailable" }, "SMX")).toBeNull();
  });
});

describe("/api/chat/gainers/news (#437)", () => {
  const member = { ok: true, user: { id: "acct-1" }, access: { longboard: true, shortscout: false, admin: false } };
  let rows: unknown[] | null = [];
  const rpc = vi.fn(async (name: string) => {
    if (name === "chat_gainers_news_for") return rows ? { data: rows, error: null } : { data: null, error: { message: "function does not exist" } };
    return { data: null, error: { message: "unexpected" } };
  });
  const get = (query: string) => GET(new NextRequest(`https://chat.test/api/chat/gainers/news${query}`));
  beforeEach(() => {
    vi.clearAllMocks();
    rows = [];
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    auth.mockResolvedValue(member);
    admin.mockReturnValue({ rpc });
  });
  afterEach(() => vi.useRealTimers());

  it("reads only the saved DilutionTracker releases for that ticker, since 30 days ago", async () => {
    rows = [release("b", 3 * DAY, "Second"), release("a", 30, "First")];
    const response = await get("?ticker=smx");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("chat_gainers_news_for", { p_tickers: ["SMX"], p_since: rowNewsSince(NOW) });
    expect(rowNewsSince(NOW)).toBe(new Date(NOW - 30 * 86_400_000).toISOString());
    const body = await response.json();
    expect(body.ticker).toBe("SMX");
    expect(body.items.map((i: { title: string }) => i.title)).toEqual(["First", "Second"]);
  });
  it("answers an empty list when there is no news", async () => {
    const body = await (await get("?ticker=NONE")).json();
    expect(body).toEqual({ ticker: "NONE", items: [] });
  });
  it("refuses a bad ticker, the signed out and members without the Gainers room", async () => {
    expect((await get("?ticker=")).status).toBe(400);
    expect((await get("")).status).toBe(400);
    auth.mockResolvedValueOnce({ ok: false, status: 401, error: "sign_in_required" });
    expect((await get("?ticker=SMX")).status).toBe(401);
    auth.mockResolvedValueOnce({ ...member, access: { longboard: false, shortscout: false, admin: false } });
    expect((await get("?ticker=SMX")).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("is unavailable (503) when the releases can't be read", async () => {
    rows = null;
    expect((await get("?ticker=SMX")).status).toBe(503);
    admin.mockReturnValueOnce(null);
    expect((await get("?ticker=SMX")).status).toBe(503);
  });
});
