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
const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
  void args;
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
    expect((await POST(post("x".repeat(5000)))).status).toBe(413);
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
    });
  });
});

describe("/api/chat/gainers/table", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());
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
      quote: { price: 2.5, changePct: 52.3, volume: 1_200_000 },
    });
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
});
