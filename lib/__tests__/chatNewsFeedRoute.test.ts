import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
const { auth, admin } = vi.hoisted(() => ({ auth: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: auth }));
vi.mock("@/lib/chatAdmin", () => ({ createChatAdminClient: admin }));
import { GET } from "@/app/api/chat/news/feed/route";
import { NEWS_TIMEOUT_MS, resetNewsCache } from "@/lib/chatNewsPolygon";

const gainersMember = { ok: true, user: { id: "acct-1" }, access: { longboard: false, shortscout: true, admin: false } };
const botNoGainers = { ok: true, user: { id: "bot" }, access: { longboard: false, shortscout: false, admin: false, botRooms: ["social"] } };
const get = () => GET(new NextRequest("https://chat.test/api/chat/news/feed"));
const db = (tickers: string[] | null) => ({
  rpc: vi.fn().mockResolvedValue(tickers ? { data: tickers.map((ticker) => ({ ticker })), error: null } : { data: null, error: { message: "down" } }),
});
const story = (id: string, minutesAgo: number, tickers: string[] = []) => ({
  id,
  title: `Story ${id}`,
  article_url: `https://news.example/${id}`,
  published_utc: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  tickers,
  publisher: { name: "Wire" },
});
type Handler = (ticker: string | null) => Response | Promise<Response>;
let fetchMock: ReturnType<typeof vi.fn>;
const stubPolygon = (handler: Handler) => {
  fetchMock = vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.hostname !== "api.polygon.io" || url.pathname !== "/v2/reference/news") throw new Error(`unexpected ${url}`);
    return handler(url.searchParams.get("ticker"));
  });
  vi.stubGlobal("fetch", fetchMock);
};
const results = (items: unknown[]) => Response.json({ status: "OK", results: items });

describe("news feed route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetNewsCache();
    vi.stubEnv("POLYGON_API_KEY", "test-key-not-real");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("refuses signed-out callers and members without Gainers before reading anything", async () => {
    stubPolygon(() => results([]));
    auth.mockResolvedValue({ ok: false, status: 401, error: "unauthorized" });
    expect((await get()).status).toBe(401);
    auth.mockResolvedValue(botNoGainers);
    expect((await get()).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(admin).not.toHaveBeenCalled();
  });

  it("reads each of today's gainers and the market, gainers' stories first, with the key in a header", async () => {
    auth.mockResolvedValue(gainersMember);
    admin.mockReturnValue(db(["ABCD", "WXYZ", "ABCD"]));
    stubPolygon((ticker) =>
      ticker === "ABCD" ? results([story("a1", 9, ["ABCD"]), story("shared", 3, ["ABCD", "WXYZ"])])
      : ticker === "WXYZ" ? results([story("shared", 3, ["ABCD", "WXYZ"])])
      : results([story("m1", 1, ["SPY"]), story("m2", 20)]),
    );
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.json();
    expect(body.gainers).toEqual(["ABCD", "WXYZ"]);
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(["shared", "a1", "m1", "m2"]);
    expect(body.partial).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain("test-key-not-real");
    expect(init.headers.Authorization).toBe("Bearer test-key-not-real");
  });

  it("caps the gainers read at 15 tickers and serves repeat viewers from the cache", async () => {
    auth.mockResolvedValue(gainersMember);
    admin.mockReturnValue(db(Array.from({ length: 30 }, (_, i) => `T${String.fromCharCode(65 + (i % 26))}${i}`)));
    stubPolygon(() => results([]));
    await get();
    expect(fetchMock).toHaveBeenCalledTimes(16);
    await get();
    expect(fetchMock).toHaveBeenCalledTimes(16);
  });

  it("returns what came back when some reads fail, and the market when the gainers list can't be read", async () => {
    auth.mockResolvedValue(gainersMember);
    admin.mockReturnValue(db(["ABCD", "WXYZ"]));
    stubPolygon((ticker) => (ticker === "WXYZ" ? new Response("nope", { status: 500 }) : results([story(ticker ?? "m", 2, ticker ? [ticker] : [])])));
    const body = await (await get()).json();
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(["ABCD", "m"]);
    expect(body.partial).toBe(true);
    resetNewsCache();
    admin.mockReturnValue(db(null));
    const marketOnly = await (await get()).json();
    expect(marketOnly).toMatchObject({ gainers: [], partial: true });
    expect(marketOnly.items.map((i: { id: string }) => i.id)).toEqual(["m"]);
  });

  it("gives up on a slow Polygon read after the timeout", async () => {
    vi.useFakeTimers();
    auth.mockResolvedValue(gainersMember);
    admin.mockReturnValue(db(["SLOW"]));
    stubPolygon(() => results([]));
    // SLOW never answers unless the route aborts it, so the answer proves the abort.
    fetchMock.mockImplementation(async (input: string, init: RequestInit) => {
      const url = new URL(input);
      if (url.searchParams.get("ticker") !== "SLOW") return results([story("m", 1)]);
      return new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    });
    const pending = get();
    await vi.advanceTimersByTimeAsync(NEWS_TIMEOUT_MS + 1);
    const body = await (await pending).json();
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(["m"]);
    expect(body.partial).toBe(true);
  });

  it("answers 503 when nothing could be read (no key, or Polygon down)", async () => {
    auth.mockResolvedValue(gainersMember);
    admin.mockReturnValue(db([]));
    stubPolygon(() => new Response("down", { status: 503 }));
    expect((await get()).status).toBe(503);
    resetNewsCache();
    vi.stubEnv("POLYGON_API_KEY", "");
    expect((await get()).status).toBe(503);
  });
});
