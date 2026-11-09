import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ChatAuthResult } from "@/lib/chatAuth";

const NOW = Date.parse("2026-11-06T15:00:00Z");
const row = (ticker: string, extra: Record<string, unknown> = {}) => ({
  ticker,
  last_alert_at: "2026-11-06T14:30:00+00:00",
  alerts: 2,
  country: null,
  country_checked_at: null,
  cash_usd: null,
  cash_months_left: null,
  cash_flow_positive: false,
  cash_checked_at: null,
  inst_own_pct: null,
  inst_own_checked_at: null,
  not_found: false,
  checked_at: null,
  ...extra,
});
const fresh = "2026-11-01T12:00:00Z";
const rows = [
  row("NEWT"),
  row("SEED", { country: "China", country_checked_at: fresh, checked_at: fresh }),
  row("DONE", { country: "U.S.", country_checked_at: fresh, cash_usd: "31500000", cash_months_left: "304.7", cash_checked_at: fresh, inst_own_pct: "12.5", inst_own_checked_at: fresh }),
  row("OLDC", { country: "U.S.", country_checked_at: fresh, cash_checked_at: "2026-10-01T12:00:00Z", inst_own_checked_at: fresh }),
  row("GONE", { not_found: true, checked_at: "2026-11-06T13:00:00Z" }),
  row("GONE2", { not_found: true, checked_at: "2026-11-06T08:00:00Z" }),
];
// #373: today's borrow checks. NEWT and SEED have none yet; DONE was checked 20 minutes ago and is
// still alerting (30 minutes ago); OLDC was checked 5 minutes ago; GONE errored 6 minutes ago.
const borrowRows = [
  { ticker: "DONE", status: "offered", etb: false, price_per_share: "0.0400", locate_type: "PreBorrow", checked_at: "2026-11-06T14:40:00+00:00", attempted_at: "2026-11-06T14:40:00+00:00" },
  { ticker: "OLDC", status: "etb", etb: true, price_per_share: null, locate_type: null, checked_at: "2026-11-06T14:55:00+00:00", attempted_at: "2026-11-06T14:55:00+00:00" },
  { ticker: "GONE", status: "error", etb: null, price_per_share: null, locate_type: null, checked_at: null, attempted_at: "2026-11-06T14:54:00+00:00" },
  { ticker: "GONE2", status: "none", etb: false, price_per_share: null, locate_type: null, checked_at: "2026-11-06T14:59:00+00:00", attempted_at: "2026-11-06T14:59:00+00:00" },
];
// #376: Interactive Brokers' latest rate for DONE (none to lend at OLDC).
const ibRows = [
  { ticker: "DONE", fee_pct: "1390.3435", rebate_pct: "-1386.4635", available: "70000", available_more: false, file_time: "2026-11-06T14:42:10+00:00", updated_at: "2026-11-06T14:45:00+00:00" },
  { ticker: "OLDC", fee_pct: null, rebate_pct: null, available: "0", available_more: false, file_time: "2026-11-06T14:42:10+00:00", updated_at: "2026-11-06T14:45:00+00:00" },
];
let borrowFails = false;
let ibFails = false;
let newsFails = false;
const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
  if (name === "chat_gainers_news_checked")
    return newsFails ? { data: null, error: { message: "function does not exist" } } : { data: [{ ticker: "DONE" }, { ticker: "GONE" }], error: null };
  if (name === "save_chat_gainers_news") return { data: (args?.p_items as unknown[]).length, error: null };
  if (name === "chat_gainers_ib_for")
    return ibFails ? { data: null, error: { message: "function does not exist" } } : { data: ibRows, error: null };
  if (name === "save_chat_gainers_ib") return { data: (args?.p_rows as unknown[]).length, error: null };
  if (name === "chat_gainers_borrow_day")
    return borrowFails ? { data: null, error: { message: "relation does not exist" } } : { data: borrowRows, error: null };
  return name === "chat_gainers_table" ? { data: rows, error: null } : { data: null, error: null };
});
vi.mock("@/lib/chatAdmin", () => ({ createChatAdminClient: () => ({ rpc }) }));
let auth: ChatAuthResult = { ok: false, status: 401, error: "unauthenticated" };
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: async () => auth }));
// #372: the table route's snapshot, never the real Polygon here.
const gainersQuotes = vi.fn(async (tickers: string[]) => new Map(tickers.map((t) => [t, t === "DONE" ? { price: 2.5, changePct: 52.3, volume: 1_200_000 } : null])));
vi.mock("@/lib/chatGainersQuotes", () => ({ gainersQuotes: (tickers: string[]) => gainersQuotes(tickers) }));

const TOKEN = "l".repeat(40);
const good = { ticker: "NEWT", notFound: false, country: "U.S.", cashUsd: 31_500_000, cashMonthsLeft: 304.7, cashFlowPositive: false, instOwnPct: 12.5 };
const post = (body: unknown, token: string | null = TOKEN, type = "application/json") =>
  new NextRequest("http://x/api/chat/gainers/facts", {
    method: "POST",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": type },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const get = (token: string | null = TOKEN) =>
  new NextRequest("http://x/api/chat/gainers/facts", { headers: token ? { authorization: `Bearer ${token}` } : {} });

describe("/api/chat/gainers/facts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    borrowFails = false;
    newsFails = false;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    process.env.CHAT_GAINERS_LOOKUP_TOKEN = TOKEN;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.CHAT_GAINERS_LOOKUP_TOKEN;
  });
  it("fails closed when the token isn't set or is short", async () => {
    const { GET, POST } = await import("@/app/api/chat/gainers/facts/route");
    delete process.env.CHAT_GAINERS_LOOKUP_TOKEN;
    expect((await GET(get())).status).toBe(503);
    expect((await POST(post(good))).status).toBe(503);
    process.env.CHAT_GAINERS_LOOKUP_TOKEN = "short";
    expect((await POST(post(good, "short"))).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses a wrong or missing token, and other tokens", async () => {
    const { GET, POST } = await import("@/app/api/chat/gainers/facts/route");
    process.env.CHAT_GAINERS_DAILY_TOKEN = "d".repeat(40);
    expect((await POST(post(good, "x".repeat(40)))).status).toBe(401);
    expect((await POST(post(good, "d".repeat(40)))).status).toBe(401);
    expect((await POST(post(good, null))).status).toBe(401);
    expect((await GET(get(null))).status).toBe(401);
    expect((await GET(get("x".repeat(40)))).status).toBe(401);
    delete process.env.CHAT_GAINERS_DAILY_TOKEN;
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses bad bodies", async () => {
    const { POST } = await import("@/app/api/chat/gainers/facts/route");
    expect((await POST(post(good, TOKEN, "text/plain"))).status).toBe(415);
    expect((await POST(post("{"))).status).toBe(400);
    expect((await POST(post({ ...good, ticker: "lower" }))).status).toBe(400);
    expect((await POST(post({ ...good, cashUsd: -1 }))).status).toBe(400);
    expect((await POST(post({ ...good, extra: 1 }))).status).toBe(400);
    const { instOwnPct, ...missing } = good;
    void instOwnPct;
    expect((await POST(post(missing))).status).toBe(400);
    expect((await POST(post("x".repeat(40_000)))).status).toBe(413);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("saves one lookup", async () => {
    const { POST } = await import("@/app/api/chat/gainers/facts/route");
    const response = await POST(post(good));
    expect(await response.json()).toEqual({ saved: true, ticker: "NEWT" });
    expect(rpc).toHaveBeenCalledWith("save_chat_gainers_facts", {
      p_ticker: "NEWT",
      p_country: "U.S.",
      p_cash_usd: 31_500_000,
      p_cash_months_left: 304.7,
      p_cash_flow_positive: false,
      p_inst_own_pct: 12.5,
      p_not_found: false,
    });
    await POST(post({ ...good, ticker: "ZZZQ", notFound: true }));
    expect(rpc).toHaveBeenLastCalledWith("save_chat_gainers_facts", expect.objectContaining({ p_ticker: "ZZZQ", p_not_found: true, p_country: null, p_cash_usd: null }));
  });
  it("lists only today's tickers that still need a lookup", async () => {
    const { GET } = await import("@/app/api/chat/gainers/facts/route");
    const body = await (await GET(get())).json();
    expect(rpc).toHaveBeenCalledWith("chat_gainers_table", { p_day: "2026-11-06" });
    expect(body).toEqual({
      day: "2026-11-06",
      needs: [
        { ticker: "NEWT", fields: ["country", "cash", "instOwn"] },
        { ticker: "SEED", fields: ["cash", "instOwn"] },
        { ticker: "OLDC", fields: ["cash"] },
        { ticker: "GONE2", fields: ["country", "cash", "instOwn"] },
      ],
      // #373: first sight (NEWT, SEED), 15 minutes on (DONE), 5 minutes after an error (GONE).
      borrow: [{ ticker: "NEWT" }, { ticker: "SEED" }, { ticker: "DONE" }, { ticker: "GONE" }],
      // #376: every ticker in today's table, for the Interactive Brokers rows.
      tickers: ["NEWT", "SEED", "DONE", "OLDC", "GONE", "GONE2"],
      // #387: every ticker whose news wasn't read yet today (DONE and GONE were).
      news: [{ ticker: "NEWT" }, { ticker: "SEED" }, { ticker: "OLDC" }, { ticker: "GONE2" }],
    });
  });
  it("lists no borrow checks while the borrow table isn't there yet (#373)", async () => {
    const { GET } = await import("@/app/api/chat/gainers/facts/route");
    borrowFails = true;
    const response = await GET(get());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.needs).toHaveLength(4);
    expect(body.borrow).toEqual([]);
  });
  const borrow = { kind: "borrow", ticker: "NEWT", status: "offered", etb: false, pricePerShare: 0.0725, locateType: "SingleUse" };
  it("saves one borrow check for today (#373)", async () => {
    const { POST } = await import("@/app/api/chat/gainers/facts/route");
    const response = await POST(post(borrow));
    expect(await response.json()).toEqual({ saved: true, ticker: "NEWT", kind: "borrow" });
    expect(rpc).toHaveBeenCalledWith("save_chat_gainers_borrow", {
      p_day: "2026-11-06",
      p_ticker: "NEWT",
      p_status: "offered",
      p_etb: false,
      p_price_per_share: 0.0725,
      p_locate_type: "SingleUse",
    });
    await POST(post({ ...borrow, status: "etb", etb: true, pricePerShare: null, locateType: null }));
    expect(rpc).toHaveBeenLastCalledWith(
      "save_chat_gainers_borrow",
      expect.objectContaining({ p_status: "etb", p_etb: true, p_price_per_share: null }),
    );
  });
  it("refuses a bad borrow check or the wrong token (#373)", async () => {
    const { POST } = await import("@/app/api/chat/gainers/facts/route");
    expect((await POST(post(borrow, "x".repeat(40)))).status).toBe(401);
    expect((await POST(post({ ...borrow, pricePerShare: -1 }))).status).toBe(400);
    expect((await POST(post({ ...borrow, status: "taken" }))).status).toBe(400);
    expect((await POST(post({ ...borrow, kind: "other" }))).status).toBe(400);
    expect((await POST(post({ ...good, kind: "borrow" }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  const ib = {
    kind: "ib",
    fileTime: "2026-11-06T14:42:10.000Z",
    rows: [
      { ticker: "NEWT", feePct: 1390.3435, rebatePct: -1386.4635, available: 70_000, availableMore: false },
      { ticker: "SEED", feePct: 0.25, rebatePct: 3.63, available: 10_000_000, availableMore: true },
      { ticker: "GONE", feePct: null, rebatePct: null, available: 0, availableMore: false },
    ],
  };
  it("saves one Interactive Brokers file's rows (#376)", async () => {
    const { POST } = await import("@/app/api/chat/gainers/facts/route");
    const response = await POST(post(ib));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ saved: 3, kind: "ib" });
    expect(rpc).toHaveBeenCalledWith("save_chat_gainers_ib", {
      p_file_time: "2026-11-06T14:42:10.000Z",
      p_rows: [
        { ticker: "NEWT", fee_pct: 1390.3435, rebate_pct: -1386.4635, available: 70_000, available_more: false },
        { ticker: "SEED", fee_pct: 0.25, rebate_pct: 3.63, available: 10_000_000, available_more: true },
        { ticker: "GONE", fee_pct: null, rebate_pct: null, available: 0, available_more: false },
      ],
    });
    // 200 rows fit in one post.
    const many = Array.from({ length: 200 }, (_, i) => ({ ...ib.rows[0], ticker: `T${"ABCDEFGHIJ"[i % 10]}${"ABCDEFGHIJKLMNOPQRST"[Math.floor(i / 10)]}` }));
    expect((await POST(post({ ...ib, rows: many }))).status).toBe(200);
  });
  it("refuses a bad Interactive Brokers post or the wrong token (#376)", async () => {
    const { POST } = await import("@/app/api/chat/gainers/facts/route");
    expect((await POST(post(ib, "x".repeat(40)))).status).toBe(401);
    expect((await POST(post(ib, null))).status).toBe(401);
    expect((await POST(post(ib, TOKEN, "text/plain"))).status).toBe(415);
    expect((await POST(post({ ...ib, rows: [] }))).status).toBe(400);
    expect((await POST(post({ ...ib, fileTime: "2026-11-06T20:00:00.000Z" }))).status).toBe(400);
    expect((await POST(post({ ...ib, rows: [{ ...ib.rows[0], available: -5 }] }))).status).toBe(400);
    expect((await POST(post({ ...ib, extra: true }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({ data: null, error: { message: "function does not exist" } });
    expect((await POST(post(ib))).status).toBe(503);
  });
  it("answers 503 when a borrow check can't be saved (#373)", async () => {
    const { POST } = await import("@/app/api/chat/gainers/facts/route");
    rpc.mockResolvedValueOnce({ data: null, error: { message: "relation does not exist" } });
    expect((await POST(post(borrow))).status).toBe(503);
  });
});

describe("/api/chat/gainers/table", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    borrowFails = false;
    ibFails = false;
  });
  const member = (access: Partial<{ longboard: boolean; shortscout: boolean; shortscoutMember: boolean; botRooms: string[] }>): ChatAuthResult => ({
    ok: true,
    user: { id: "u", email: "u@example.test", role: "user" },
    access: { longboard: false, shortscout: false, admin: false, ...access },
    serverSession: false,
  });
  const read = async () => {
    const { GET } = await import("@/app/api/chat/gainers/table/route");
    return GET(new NextRequest("http://x/api/chat/gainers/table"));
  };
  it("is for the members who can open the gainers room", async () => {
    auth = { ok: false, status: 401, error: "unauthenticated" };
    expect((await read()).status).toBe(401);
    auth = member({ botRooms: ["lb-review"] });
    expect((await read()).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
    for (const access of [{ longboard: true }, { shortscout: true }, { shortscoutMember: true }]) {
      auth = member(access);
      expect((await read()).status).toBe(200);
    }
  });
  it("returns today's rows with their facts", async () => {
    auth = member({ longboard: true });
    const body = await (await read()).json();
    expect(body.day).toBe("2026-11-06");
    expect(body.rows.map((r: { sym: string }) => r.sym)).toEqual(["NEWT", "SEED", "DONE", "OLDC", "GONE", "GONE2"]);
    expect(body.rows[2]).toEqual({
      sym: "DONE",
      lastAlertAt: "2026-11-06T14:30:00.000Z",
      alerts: 2,
      country: "U.S.",
      countryChecked: true,
      cashUsd: 31_500_000,
      cashMonthsLeft: 304.7,
      cashFlowPositive: false,
      cashChecked: true,
      instOwnPct: 12.5,
      instOwnChecked: true,
      notFound: false,
      factsCheckedAt: null,
      lastAfterHours: false,
      quote: { price: 2.5, changePct: 52.3, volume: 1_200_000 },
      borrow: {
        status: "offered",
        etb: false,
        pricePerShare: 0.04,
        locateType: "PreBorrow",
        checkedAt: "2026-11-06T14:40:00.000Z",
        attemptedAt: "2026-11-06T14:40:00.000Z",
      },
      ib: { feePct: 1390.3435, rebatePct: -1386.4635, available: 70_000, availableMore: false, fileTime: "2026-11-06T14:42:10.000Z" },
    });
    // #412: the facts lookup's time, for the Updated column.
    expect(body.rows[1].factsCheckedAt).toBe("2026-11-01T12:00:00.000Z");
    expect(rpc).toHaveBeenCalledWith("chat_gainers_ib_for", { p_tickers: ["NEWT", "SEED", "DONE", "OLDC", "GONE", "GONE2"] });
    expect(body.rows[3].ib).toMatchObject({ available: 0, feePct: null });
    expect(body.rows[0].ib).toBeNull();
    expect(rpc).toHaveBeenCalledWith("chat_gainers_borrow_day", { p_day: "2026-11-06" });
    expect(body.rows[0].borrow).toBeNull();
    expect(body.rows[3].borrow).toMatchObject({ status: "etb", etb: true });
    expect(gainersQuotes).toHaveBeenCalledTimes(1);
    expect(gainersQuotes).toHaveBeenCalledWith(["NEWT", "SEED", "DONE", "OLDC", "GONE", "GONE2"]);
    expect(body.rows[0].quote).toBeNull();
  });
  it("still returns the table when the snapshot fails (#372)", async () => {
    auth = member({ longboard: true });
    gainersQuotes.mockRejectedValueOnce(new Error("polygon down"));
    const response = await read();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rows).toHaveLength(6);
    expect(body.rows.every((r: { quote: unknown }) => r.quote === null)).toBe(true);
  });
  it("still returns the table without the borrow checks (#373)", async () => {
    auth = member({ longboard: true });
    borrowFails = true;
    const response = await read();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rows).toHaveLength(6);
    expect(body.rows.every((r: { borrow: unknown }) => r.borrow === null)).toBe(true);
    expect(body.rows[2].quote).not.toBeNull();
  });
  it("still returns the table without the Interactive Brokers rows (#376)", async () => {
    auth = member({ longboard: true });
    ibFails = true;
    const response = await read();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rows.every((r: { ib: unknown }) => r.ib === null)).toBe(true);
    expect(body.rows[2].borrow).not.toBeNull();
  });
});

describe("/api/chat/gainers/facts news reads (#387)", () => {
  const release = (id: string, publishedAt: string, extra: Record<string, unknown> = {}) => ({
    publishedAt,
    source: "ACCESS Newswire",
    title: `Synthetic release ${id}`,
    url: `https://dilution.news/${id}`,
    dtItemId: id,
    ...extra,
  });
  const news = { kind: "news", ticker: "NEWT", items: [release("aaaa1111", "2026-11-06T14:15:00.000Z"), release("bbbb2222", "2026-11-05T15:30:00.000Z", { dtItemId: null, url: "https://www.accessnewswire.com/x" })] };
  beforeEach(() => {
    vi.clearAllMocks();
    newsFails = false;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    process.env.CHAT_GAINERS_LOOKUP_TOKEN = TOKEN;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.CHAT_GAINERS_LOOKUP_TOKEN;
  });
  it("saves one ticker's read for today, keyed by DilutionTracker's id or the link", async () => {
    const { POST } = await import("@/app/api/chat/gainers/facts/route");
    const response = await POST(post(news));
    expect(await response.json()).toEqual({ saved: 2, ticker: "NEWT", kind: "news" });
    expect(rpc).toHaveBeenCalledWith("save_chat_gainers_news", {
      p_day: "2026-11-06",
      p_ticker: "NEWT",
      p_items: [
        { key: "dt:aaaa1111", published_at: "2026-11-06T14:15:00.000Z", source: "ACCESS Newswire", title: "Synthetic release aaaa1111", url: "https://dilution.news/aaaa1111" },
        { key: "https://www.accessnewswire.com/x", published_at: "2026-11-05T15:30:00.000Z", source: "ACCESS Newswire", title: "Synthetic release bbbb2222", url: "https://www.accessnewswire.com/x" },
      ],
    });
    // A read with nothing in it still counts as today's read.
    await POST(post({ ...news, items: [] }));
    expect(rpc).toHaveBeenLastCalledWith("save_chat_gainers_news", expect.objectContaining({ p_items: [] }));
  });
  it("refuses a bad read or the wrong token", async () => {
    const { POST } = await import("@/app/api/chat/gainers/facts/route");
    expect((await POST(post(news, "x".repeat(40)))).status).toBe(401);
    expect((await POST(post({ ...news, ticker: "bad" }))).status).toBe(400);
    expect((await POST(post({ ...news, extra: 1 }))).status).toBe(400);
    expect((await POST(post({ ...news, items: [release("cccc3333", "2026-11-06T14:15:00Z", { url: "javascript:alert(1)" })] }))).status).toBe(400);
    expect((await POST(post({ ...news, items: [release("cccc3333", "soon")] }))).status).toBe(400);
    expect((await POST(post({ ...news, items: [release("cccc3333", "2026-11-06T14:15:00Z", { title: "bad\u0000title" })] }))).status).toBe(400);
    expect((await POST(post({ ...news, items: [release("cccc3333", "2026-11-06T14:15:00Z", { dtItemId: "../../x" })] }))).status).toBe(400);
    expect((await POST(post({ ...news, items: Array.from({ length: 61 }, (_, i) => release(`id${i}xx`, "2026-11-06T14:15:00Z")) }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("lists no news reads while the news tables aren't there yet", async () => {
    const { GET } = await import("@/app/api/chat/gainers/facts/route");
    newsFails = true;
    const body = await (await GET(get())).json();
    expect(body.news).toEqual([]);
    expect(body.needs).toHaveLength(4);
  });
});
