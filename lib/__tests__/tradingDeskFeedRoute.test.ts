import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// #469 The ingest route (home computer -> chat) and the owner's desk route choosing the real snapshot
// or the sample. The database is a fake that keeps the one row in memory.
const { auth, store } = vi.hoisted(() => ({
  auth: vi.fn(),
  store: { row: null as null | { snapshot: unknown; received_at: string }, fail: false, saves: 0 },
}));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: auth }));
vi.mock("@/lib/chatAdmin", () => ({
  createChatAdminClient: () => ({
    rpc: async (name: string, args: { p_snapshot: unknown }) => {
      if (store.fail || name !== "save_chat_trading_desk_snapshot") return { data: null, error: { message: "no such function" } };
      store.saves += 1;
      store.row = { snapshot: JSON.parse(JSON.stringify(args.p_snapshot)), received_at: new Date().toISOString() };
      return { data: store.row.received_at, error: null };
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            store.fail || table !== "chat_trading_desk_snapshot" ? { data: null, error: { message: "relation does not exist" } } : { data: store.row, error: null },
        }),
      }),
    }),
  }),
}));
import { POST } from "@/app/api/chat/trading-desk/feed/route";
import { GET } from "@/app/api/chat/trading-desk/route";
import { CHAT_OWNER_ENV } from "@/lib/chatOwner";
import { DESK_FEED_MAX_BYTES, DESK_FEED_TOKEN_ENV, parseTradingDeskSnapshot } from "@/lib/tradingDeskFeed";

const TOKEN = "f".repeat(48);
const ROB = "77a2d10f-0000-4000-8000-0000000000aa";
const rob = { ok: true as const, user: { id: ROB, email: "rob@example.test", role: "admin" as const }, access: { longboard: true, boardroom: true, shortscout: false, admin: true }, serverSession: false };

function snapshot(extra: Record<string, unknown> = {}) {
  return {
    sample: false,
    account: { accountStatus: "Active", accountType: "Paper", availableCash: 100, buyingPower: 2000, equity: 1000, leverage: 2, overnightBp: null, totalLocateCosts: null, sharesTraded: 0 },
    positions: [{ positionId: "ABCD", symbol: "ABCD", shares: 100, side: "Long", priceAvg: 2 }],
    pnl: { accountValue: 1000, exposure: 210, dayPnl: 10, dayUnrealized: 10, totalUnrealized: 10, pnl: [{ positionId: "ABCD", unrealizedPnL: 10, exposure: 210, dayPnl: null }] },
    orders: [{ clientOrderId: "o-1", symbol: "ABCD", side: "Sell", orderQuantity: 100, orderStatus: "New", limitPrice: 2.5, leavesQuantity: 100, priceAvg: 0, route: "SMART", orderType: null, timeInForce: null, stopPrice: null, rangeLowPrice: null, rangeHighPrice: null, createdDate: null }],
    bridge: { updatedAt: new Date().toISOString(), source: "home computer", automation: "off", positions: {}, activity: [], feed: { state: "ok", stream: "off", pollEveryMs: 5000, errors: [] } },
    ...extra,
  };
}

const post = (body: unknown, headers: Record<string, string> = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }) =>
  POST(new NextRequest("https://chat.example.test/api/chat/trading-desk/feed", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeEach(() => {
  vi.stubEnv(DESK_FEED_TOKEN_ENV, TOKEN);
  vi.stubEnv(CHAT_OWNER_ENV, ROB);
  store.row = null;
  store.fail = false;
  store.saves = 0;
});
afterEach(() => {
  vi.unstubAllEnvs();
  auth.mockReset();
});

describe("#469 POST /api/chat/trading-desk/feed", () => {
  it("saves a good snapshot sent with the feed token", async () => {
    const response = await post(snapshot());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ saved: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(store.saves).toBe(1);
    expect(parseTradingDeskSnapshot(store.row?.snapshot)).toMatchObject({ sample: false, account: { accountType: "Paper" } });
  });

  it("refuses a missing, wrong or non-bearer token, and anything when no token is configured", async () => {
    for (const headers of [
      { "content-type": "application/json" } as Record<string, string>,
      { authorization: `Bearer ${TOKEN}x`, "content-type": "application/json" },
      { authorization: "Bearer ", "content-type": "application/json" },
      { authorization: TOKEN, "content-type": "application/json" },
      { authorization: `Basic ${TOKEN}`, "content-type": "application/json" },
    ]) {
      const response = await post(snapshot(), headers);
      expect(response.status).toBe(401);
    }
    vi.stubEnv(DESK_FEED_TOKEN_ENV, "");
    expect((await post(snapshot())).status).toBe(503);
    vi.stubEnv(DESK_FEED_TOKEN_ENV, "short");
    expect((await post(snapshot(), { authorization: "Bearer short", "content-type": "application/json" })).status).toBe(503);
    expect(store.saves).toBe(0);
  });

  it("refuses an oversized body, by its length or by what actually arrives", async () => {
    const big = JSON.stringify({ ...snapshot(), pad: "x".repeat(DESK_FEED_MAX_BYTES) });
    expect((await post(big)).status).toBe(413);
    const stream = new ReadableStream({
      start(controller) {
        for (let i = 0; i < 4; i++) controller.enqueue(new TextEncoder().encode("x".repeat(DESK_FEED_MAX_BYTES / 2)));
        controller.close();
      },
    });
    const response = await POST(
      new NextRequest("https://chat.example.test/api/chat/trading-desk/feed", { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: stream, duplex: "half" } as ConstructorParameters<typeof NextRequest>[1]),
    );
    expect(response.status).toBe(413);
    expect(store.saves).toBe(0);
  });

  it("refuses what isn't a valid snapshot", async () => {
    const bad = [
      "not json",
      [],
      { ...snapshot(), sample: true },
      { ...snapshot(), positions: "x" },
      { ...snapshot(), positions: Array.from({ length: 201 }, (_, i) => ({ positionId: `P${i}`, symbol: "ABCD", shares: 1, side: "Long", priceAvg: 1 })) },
      { ...snapshot(), account: { ...snapshot().account, equity: Number.MAX_VALUE } },
      { ...snapshot(), account: { ...snapshot().account, accountType: "Margin" } },
      { ...snapshot(), orders: [{ ...snapshot().orders[0], orderStatus: "Filled" }] },
      { ...snapshot(), orders: [{ ...snapshot().orders[0], symbol: "<script>" }] },
      { ...snapshot(), bridge: { ...snapshot().bridge, updatedAt: "yesterday" } },
      { ...snapshot(), bridge: { ...snapshot().bridge, updatedAt: new Date(Date.now() + 3_600_000).toISOString() } },
      { ...snapshot(), bridge: { ...snapshot().bridge, feed: { state: "ok", stream: "off", pollEveryMs: 5000, errors: ["a", "b", "c", "d", "e", "f"] } } },
      { ...snapshot(), bridge: { ...snapshot().bridge, source: "line\nbreak" } },
    ];
    for (const body of bad) expect((await post(body)).status, JSON.stringify(body).slice(0, 80)).toBe(400);
    expect((await post(snapshot(), { authorization: `Bearer ${TOKEN}`, "content-type": "text/plain" })).status).toBe(415);
    expect(store.saves).toBe(0);
  });

  it("keeps only the known fields", async () => {
    await post({ ...snapshot(), extra: "dropped", account: { ...snapshot().account, account: "SHOULD-NOT-STAY" } });
    expect(JSON.stringify(store.row?.snapshot)).not.toMatch(/dropped|SHOULD-NOT-STAY/);
  });

  it("answers 503 before the migration is applied", async () => {
    store.fail = true;
    expect((await post(snapshot())).status).toBe(503);
  });
});

describe("#469 GET /api/chat/trading-desk: real snapshot or sample", () => {
  it("serves the sample, marked, until a snapshot has arrived (or when the table isn't there)", async () => {
    auth.mockResolvedValue(rob);
    let body = await (await GET()).json();
    expect(body.desk).toMatchObject({ sample: true, accountType: null });
    store.fail = true;
    body = await (await GET()).json();
    expect(body.desk.sample).toBe(true);
  });

  it("serves the latest snapshot once there is one, with its Paper/Live badge and — for what's missing", async () => {
    auth.mockResolvedValue(rob);
    await post(snapshot());
    const body = await (await GET()).json();
    expect(body.desk).toMatchObject({ sample: false, accountType: "Paper", automation: "off", staleAfterMs: 30_000, feedErrors: [] });
    expect(body.desk.positions).toHaveLength(1);
    expect(body.desk.orders[0]).toMatchObject({ type: null, tif: null, placedAt: null, price: "2.50" });
    expect(body.desk.positions[0].dayPnl).toBeNull();
  });

  it("still serves an old snapshot (the desk marks it stale), and the feed's errors", async () => {
    auth.mockResolvedValue(rob);
    const old = new Date(Date.now() - 3_600_000).toISOString();
    await post(snapshot({ bridge: { ...snapshot().bridge, updatedAt: old, feed: { state: "error", stream: "off", pollEveryMs: 60000, errors: ["TradeZero unreachable (TimeoutError)"] } } }));
    const body = await (await GET()).json();
    expect(body.desk).toMatchObject({ sample: false, updatedAt: old, staleAfterMs: 150_000, feedErrors: ["TradeZero unreachable (TimeoutError)"] });
  });

  it("still answers everyone but the owner with 404, even with a snapshot saved", async () => {
    await post(snapshot());
    auth.mockResolvedValue({ ...rob, user: { ...rob.user, id: "6ad10d99-0000-4000-8000-0000000000bb" } });
    expect((await GET()).status).toBe(404);
    auth.mockResolvedValue({ ...rob, apiToken: true });
    expect((await GET()).status).toBe(404);
  });
});
