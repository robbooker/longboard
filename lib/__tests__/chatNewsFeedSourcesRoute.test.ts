import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const { auth, admin } = vi.hoisted(() => ({ auth: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: auth }));
vi.mock("@/lib/chatAdmin", () => ({ createChatAdminClient: admin }));
import { GET } from "@/app/api/chat/news/feed/route";
import { resetNewsCache } from "@/lib/chatNewsPolygon";
import { resetFmpCache } from "@/lib/chatNewsFmp";

// #387: the feed route with DilutionTracker's saved releases, Polygon and FMP (all synthetic, no live calls).
const NOW = Date.parse("2026-11-08T15:00:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const member = { ok: true, user: { id: "acct-1" }, access: { longboard: true, shortscout: false, admin: false } };
const get = () => GET(new NextRequest("https://chat.test/api/chat/news/feed"));
let dtRows: unknown[] | null = [];
const rpc = vi.fn(async (name: string) => {
  if (name === "chat_gainers_table") return { data: [{ ticker: "SMX" }, { ticker: "AEHL" }], error: null };
  if (name === "chat_gainers_news_for") return dtRows ? { data: dtRows, error: null } : { data: null, error: { message: "function does not exist" } };
  return { data: null, error: { message: "unexpected" } };
});
const release = (ticker: string, key: string, minutes: number, title: string, source = "ACCESS Newswire") => ({
  ticker,
  item_key: `dt:${key}`,
  published_at: ago(minutes),
  source,
  title,
  url: `https://dilution.news/${key}`,
});
const polygon = (id: string, minutes: number, tickers: string[], title = `Polygon ${id}`) => ({
  id,
  title,
  article_url: `https://news.example/${id}`,
  published_utc: ago(minutes),
  tickers,
  publisher: { name: "GlobeNewswire Inc." },
});
// FMP's times are New York wall-clock (EST on Nov 8: UTC minus five hours).
const fmp = (n: number, minutes: number, title = `FMP ${n}`) => ({
  symbol: "None",
  publishedDate: new Date(NOW - 5 * 3_600_000 - minutes * 60_000).toISOString().slice(0, 19).replace("T", " "),
  publisher: "Barrons",
  site: "barrons.com",
  title,
  url: `https://www.barrons.com/articles/${n}`,
});
let fmpDown = false;
let fetchMock: ReturnType<typeof vi.fn>;

describe("news feed route with every source (#387)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetNewsCache();
    resetFmpCache();
    dtRows = [];
    fmpDown = false;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    vi.stubEnv("POLYGON_API_KEY", "polygon-test-key");
    vi.stubEnv("FMP_API_KEY", "fmp-test-key");
    auth.mockResolvedValue(member);
    admin.mockReturnValue({ rpc });
    fetchMock = vi.fn(async (input: string) => {
      const url = new URL(String(input));
      if (url.hostname === "financialmodelingprep.com")
        return fmpDown ? new Response("down", { status: 502 }) : Response.json(url.pathname.endsWith("general-latest") ? [fmp(1, 2), fmp(2, 40, "Stocks slip as yields climb")] : [fmp(3, 9)]);
      if (url.hostname === "api.polygon.io") {
        const ticker = url.searchParams.get("ticker");
        if (ticker === "SMX") return Response.json({ results: [polygon("p-smx", 61, ["SMX"], "SMX Announces Effective Date of Reverse Stock Split")] });
        if (ticker === "AEHL") return Response.json({ results: [] });
        return Response.json({ results: [polygon("p-mkt", 5, ["SPY"]), polygon("p-dup", 41, [], "Stocks Slip as Yields Climb")] });
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("puts every gainer release first with its wire, then Polygon and FMP market news, each story once", async () => {
    dtRows = [
      release("SMX", "a1", 30, "Plastic Recycling has a New Passport; SMX is the Stamp"),
      release("SMX", "a2", 60, "SMX Announces Effective Date of Reverse Stock Split"),
      release("AEHL", "b1", 6 * 1440, "Antelope Enterprise Announces Something Older", "GlobeNewswire"),
    ];
    const body = await (await get()).json();
    expect(rpc).toHaveBeenCalledWith("chat_gainers_news_for", { p_tickers: ["SMX", "AEHL"], p_since: new Date(NOW - 30 * 86_400_000).toISOString() });
    expect(body.gainers).toEqual(["SMX", "AEHL"]);
    expect(body.partial).toBe(false);
    expect(body.items.map((i: { origin: string; title: string; source: string; older?: boolean }) => [i.origin, i.source, i.title, !!i.older])).toEqual([
      ["dt", "ACCESS Newswire", "Plastic Recycling has a New Passport; SMX is the Stamp", false],
      ["dt", "ACCESS Newswire", "SMX Announces Effective Date of Reverse Stock Split", false],
      ["fmp", "Barron's", "FMP 1", false],
      ["polygon", "GlobeNewswire", "Polygon p-mkt", false],
      ["fmp", "Barron's", "FMP 3", false],
      ["polygon", "GlobeNewswire", "Stocks Slip as Yields Climb", false],
      ["dt", "GlobeNewswire", "Antelope Enterprise Announces Something Older", true],
    ]);
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("financialmodelingprep")).every(([u, init]) => !String(u).includes("fmp-test-key") && init.headers.apikey === "fmp-test-key")).toBe(true);
  });

  it("keeps going when FMP fails (partial) or the news tables aren't there yet (not partial)", async () => {
    fmpDown = true;
    dtRows = null;
    const body = await (await get()).json();
    expect(body.partial).toBe(true);
    expect(body.items.map((i: { origin: string }) => i.origin)).toEqual(["polygon", "polygon", "polygon"]);
    resetFmpCache();
    fmpDown = false;
    const again = await (await get()).json();
    expect(again.partial).toBe(false);
    expect(again.items.some((i: { origin: string }) => i.origin === "fmp")).toBe(true);
  });

  it("still answers with the saved releases when Polygon and FMP are both down", async () => {
    dtRows = [release("SMX", "a1", 30, "A release")];
    fetchMock.mockImplementation(async () => new Response("down", { status: 503 }));
    const response = await get();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ partial: true });
    expect(body.items.map((i: { title: string }) => i.title)).toEqual(["A release"]);
  });
});
