import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSnapshot, mentionsAccount, stripAccount } from "../../scripts/trading-desk-feed/snapshot.mjs";
import { chatPoster, createFeed, loadToken, loadTradeZeroKey, marketHours, nextWait } from "../../scripts/trading-desk-feed/feed.mjs";
import { openPnlStream, streamUrl } from "../../scripts/trading-desk-feed/stream.mjs";
import { createReadOnlyClient } from "../../scripts/trading-desk-feed/tz-readonly.mjs";
import { parseTradingDeskSnapshot } from "@/lib/tradingDeskFeed";
import { deskFromTradeZero } from "@/lib/tradingDesk";

// #469 The feed against a fake TradeZero on this computer (replies in the shapes TZ-RECON recorded,
// with the account number echoed the way TradeZero does). Nothing talks to the real TradeZero.
const ACCT = "TESTACCT1";
const TOKEN = "t".repeat(40);
const NOW = Date.parse("2026-11-19T15:00:00Z"); // 10 AM New York, a Thursday

const replies: Record<string, unknown> = {
  [`/v1/api/account/${ACCT}`]: {
    account: ACCT,
    accountStatus: "Active",
    accountType: "Live",
    availableCash: 1000,
    bp: 75000,
    equity: 37736.12,
    leverage: 2,
    overnightBp: 70000,
    totalLocateCosts: 12.5,
    sharesTraded: 1200,
  },
  [`/v1/api/accounts/${ACCT}/positions`]: [
    { accountId: ACCT, symbol: "ABCD", shares: 1000, side: "Long", priceAvg: 2.1 },
    { accountId: ACCT, positionId: `${ACCT}-WXYZ`, symbol: "WXYZ", shares: -500, side: "Short", priceAvg: 5 },
  ],
  [`/v1/api/accounts/${ACCT}/pnl`]: {
    accountId: ACCT,
    accountValue: 38000,
    exposure: 4825,
    dayPnl: 250.5,
    dayUnrealized: 175,
    totalUnrealized: 175,
    pnl: [
      { positionId: "ABCD", symbol: "ABCD", unrealizedPnL: 200, exposure: 2300 },
      { positionId: `${ACCT}-WXYZ`, symbol: "WXYZ", unrealizedPnL: -25, exposure: 2525 },
    ],
  },
  [`/v1/api/accounts/${ACCT}/orders`]: [
    // What TZ-RECON saw: no order type, time in force or time.
    { accountId: ACCT, clientOrderId: "bot-0001", symbol: "ABCD", side: "Sell", orderQuantity: 1000, orderStatus: "New", limitPrice: 2.5, leavesQuantity: 1000, priceAvg: 0, route: "SMART" },
    { accountId: ACCT, clientOrderId: "TZ-1", symbol: "WXYZ", side: "Cover", orderQuantity: 500, orderStatus: "PartiallyFilled", orderType: "StopLimit", timeInForce: "GTC", stopPrice: 5.4, limitPrice: 5.5, leavesQuantity: 200, priceAvg: 5.38, route: "EDGX", createdDate: "2026-11-19T14:31:00Z" },
    { accountId: ACCT, clientOrderId: "TZ-2", symbol: "ABCD", side: "Buy", orderQuantity: 1000, orderStatus: "Filled", leavesQuantity: 0, priceAvg: 2.1, route: "SMART" },
    { accountId: ACCT, clientOrderId: "TZ-3", symbol: "ABCD", side: "Buy", orderQuantity: 100, orderStatus: "Canceled", leavesQuantity: 100, priceAvg: 0, route: "SMART" },
    { accountId: ACCT, clientOrderId: ACCT, symbol: "QQQQ", side: "Buy", orderQuantity: 100, orderStatus: "New", leavesQuantity: 100, priceAvg: 0, route: "ARCA", orderType: "Market", timeInForce: "Day+" },
  ],
};

type Hit = { method: string; path: string; auth: string | undefined; keyId: string | undefined; body: string };
let server: Server;
let base = "";
const hits: Hit[] = [];
let tzStatus = 200;
const posted: unknown[] = [];

const readBody = async (req: IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
};

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const body = await readBody(req);
    hits.push({ method: req.method ?? "", path: url.pathname, auth: req.headers.authorization, keyId: req.headers["tz-api-key-id"] as string | undefined, body });
    if (url.pathname === "/api/chat/trading-desk/feed") {
      if (req.headers.authorization !== `Bearer ${TOKEN}`) {
        res.writeHead(401, { "content-type": "application/json" });
        return res.end('{"error":"unauthorized"}');
      }
      posted.push(JSON.parse(body));
      res.writeHead(200, { "content-type": "application/json" });
      return res.end('{"saved":true}');
    }
    if (tzStatus !== 200 || req.method !== "GET" || !(url.pathname in replies)) {
      res.writeHead(tzStatus !== 200 ? tzStatus : 404);
      return res.end();
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(replies[url.pathname]));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

function feedFor(now = () => NOW) {
  const client = createReadOnlyClient({ keyId: "synthetic-key-id", secret: "synthetic-secret", accountId: ACCT, baseUrl: base, gapMs: 0, sleep: async () => {} });
  const logs: string[] = [];
  const feed = createFeed({ client, post: chatPoster(base, TOKEN), accountId: ACCT, now, onLog: (line: string) => logs.push(line) });
  return { feed, logs };
}

describe("#469 one round of the feed against a fake TradeZero", () => {
  it("reads with four GETs to the allowed addresses and sends one snapshot to the chat", async () => {
    hits.length = 0;
    posted.length = 0;
    const { feed } = feedFor();
    const round = await feed.tick();
    expect(round).toMatchObject({ ok: true, posted: true, wait: 5_000, pollEveryMs: 5_000 });
    const tz = hits.filter((h) => h.path.startsWith("/v1/"));
    expect(tz.map((h) => `${h.method} ${h.path}`)).toEqual([
      `GET /v1/api/account/${ACCT}`,
      `GET /v1/api/accounts/${ACCT}/positions`,
      `GET /v1/api/accounts/${ACCT}/pnl`,
      `GET /v1/api/accounts/${ACCT}/orders`,
    ]);
    for (const h of tz) {
      expect(h.body).toBe("");
      expect(h.keyId).toBe("synthetic-key-id");
    }
    // The chat gets the bearer token and never the TradeZero key.
    const chat = hits.filter((h) => h.path === "/api/chat/trading-desk/feed");
    expect(chat).toHaveLength(1);
    expect(chat[0].method).toBe("POST");
    expect(chat[0].keyId).toBeUndefined();
    expect(chat[0].body).not.toMatch(/synthetic-key-id|synthetic-secret/);
    expect(posted).toHaveLength(1);
  });

  it("builds the feed shape with the account number stripped everywhere", async () => {
    posted.length = 0;
    await feedFor().feed.tick();
    const snapshot = posted[0] as Record<string, unknown>;
    expect(JSON.stringify(snapshot)).not.toContain(ACCT);
    expect(JSON.stringify(snapshot).toLowerCase()).not.toContain(ACCT.toLowerCase());
    expect(snapshot).not.toHaveProperty("account.account");
    const feed = parseTradingDeskSnapshot(snapshot, NOW)!;
    expect(feed).not.toBeNull();
    expect(feed.sample).toBe(false);
    expect(feed.account).toEqual({
      accountStatus: "Active",
      accountType: "Live",
      availableCash: 1000,
      buyingPower: 75000,
      equity: 37736.12,
      leverage: 2,
      overnightBp: 70000,
      totalLocateCosts: 12.5,
      sharesTraded: 1200,
    });
    expect(feed.positions).toEqual([
      { positionId: "ABCD", symbol: "ABCD", shares: 1000, side: "Long", priceAvg: 2.1 },
      { positionId: "-WXYZ", symbol: "WXYZ", shares: 500, side: "Short", priceAvg: 5 },
    ]);
    expect(feed.pnl.pnl.map((r) => [r.positionId, r.unrealizedPnL, r.dayPnl])).toEqual([
      ["ABCD", 200, null],
      ["-WXYZ", -25, null],
    ]);
    // Only working orders, with what TradeZero left out as null.
    expect(feed.orders.map((o) => o.clientOrderId)).toEqual(["bot-0001", "TZ-1", "QQQQ-3"]);
    expect(feed.orders[0]).toMatchObject({ orderType: null, timeInForce: null, createdDate: null, side: "Sell", limitPrice: 2.5 });
    expect(feed.orders[1]).toMatchObject({ orderType: "StopLimit", timeInForce: "GTC", orderStatus: "PartiallyFilled", createdDate: "2026-11-19T14:31:00.000Z" });
    expect(feed.orders[2]).toMatchObject({ orderType: "Market", timeInForce: "Day_Plus" });
    expect(feed.bridge).toMatchObject({
      updatedAt: new Date(NOW).toISOString(),
      source: "home computer",
      automation: "off",
      feed: { state: "ok", stream: "off", pollEveryMs: 5_000, errors: [] },
    });
  });

  it("draws on the desk with — where TradeZero sent nothing, and a Live badge", async () => {
    posted.length = 0;
    await feedFor().feed.tick();
    const desk = deskFromTradeZero(parseTradingDeskSnapshot(posted[0], NOW)!);
    expect(desk.sample).toBe(false);
    expect(desk.accountType).toBe("Live");
    expect(desk.automation).toBe("off");
    expect(desk.staleAfterMs).toBe(30_000);
    expect(desk.account).toMatchObject({ equity: 37736.12, buyingPower: 75000, dayPnl: 250.5, dayUnrealized: 175, dayRealized: 75.5, openPnl: 175 });
    expect(desk.positions.map((p) => p.dayPnl)).toEqual([null, null]);
    expect(desk.totals.dayPnl).toBeNull();
    expect(desk.positions[0].last).toBeCloseTo(2.3, 4);
    expect(desk.positions[1].last).toBeCloseTo(5.05, 4);
    expect(desk.orders[0]).toMatchObject({ type: null, tif: null, placedAt: null, price: "2.50", placedBy: "Bot" });
    expect(desk.orders[1]).toMatchObject({ type: "Stop Limit", tif: "GTC", filled: 300, remaining: 200 });
  });

  it("sends nothing before its first good read, then reports failures with the last good numbers", async () => {
    posted.length = 0;
    let t = NOW;
    const { feed, logs } = feedFor(() => t);
    tzStatus = 503;
    try {
      expect(await feed.tick()).toMatchObject({ ok: false, posted: false, wait: 10_000 });
      tzStatus = 200;
      expect(await feed.tick()).toMatchObject({ ok: true, posted: true });
      t += 5_000;
      tzStatus = 429;
      expect(await feed.tick()).toMatchObject({ ok: false, posted: true, wait: 10_000 });
      t += 10_000;
      expect(await feed.tick()).toMatchObject({ ok: false, posted: true, wait: 20_000 });
    } finally {
      tzStatus = 200;
    }
    const last = parseTradingDeskSnapshot(posted.at(-1), t)!;
    expect(last.bridge.updatedAt).toBe(new Date(NOW).toISOString());
    expect(last.bridge.feed).toMatchObject({ state: "error", errors: ["TradeZero said slow down (429) (2 tries in a row)"] });
    expect(last.positions).toHaveLength(2);
    expect(logs.join("\n")).not.toMatch(/synthetic|TESTACCT1/);
  });

  it("logs a refused chat token and carries on", async () => {
    const client = createReadOnlyClient({ keyId: "k", secret: "s", accountId: ACCT, baseUrl: base, gapMs: 0 });
    const logs: string[] = [];
    const feed = createFeed({ client, post: chatPoster(base, "wrong".repeat(10)), accountId: ACCT, now: () => NOW, onLog: (l: string) => logs.push(l) });
    expect(await feed.tick()).toMatchObject({ ok: true, posted: false });
    expect(logs).toEqual(["chat: the chat refused the feed token (401)"]);
  });
});

describe("#469 snapshot details", () => {
  it("never sends a snapshot that still mentions the account number", () => {
    expect(mentionsAccount({ a: [{ b: `x${ACCT.toLowerCase()}y` }] }, ACCT)).toBe(true);
    expect(mentionsAccount({ [`k${ACCT}`]: 1 }, ACCT)).toBe(true);
    // Numbers aren't text: an all-digit account number inside a balance doesn't count.
    expect(mentionsAccount({ equity: 135309.12 }, "35309")).toBe(false);
    expect(stripAccount({ id: `${ACCT}-AAPL`, n: 5 }, ACCT)).toEqual({ id: "-AAPL", n: 5 });
  });

  it("lays newer stream P&L over the REST P&L, only for open positions", () => {
    const raw = {
      account: replies[`/v1/api/account/${ACCT}`],
      positions: replies[`/v1/api/accounts/${ACCT}/positions`],
      pnl: replies[`/v1/api/accounts/${ACCT}/pnl`],
      orders: [],
    };
    const stream = { values: { dayPnl: 300 }, rows: [{ positionId: "", symbol: "ABCD", unrealizedPnL: 250, exposure: null, dayPnl: 40 }, { positionId: "GONE", symbol: "GONE", unrealizedPnL: 9, exposure: 9, dayPnl: 9 }] };
    const s = buildSnapshot({ raw, accountId: ACCT, heardAt: NOW, stream, feed: { state: "ok", stream: "connected", pollEveryMs: 5000, errors: [] } });
    expect(s.pnl.dayPnl).toBe(300);
    expect(s.pnl.pnl).toEqual([
      { positionId: "ABCD", unrealizedPnL: 250, exposure: 2300, dayPnl: 40 },
      { positionId: "-WXYZ", unrealizedPnL: -25, exposure: 2525, dayPnl: null },
    ]);
  });

  it("reads TradeZero's /accounts list too, picking the configured account", () => {
    const raw = { account: { accounts: [{ account: "OTHER", equity: 1 }, { account: ACCT, equity: 2, accountType: "Paper" }] }, positions: [], pnl: {}, orders: [] };
    const s = buildSnapshot({ raw, accountId: ACCT, heardAt: NOW, feed: { state: "ok", stream: "off", pollEveryMs: 60000, errors: [] } });
    expect(s.account).toMatchObject({ equity: 2, accountType: "Paper", buyingPower: null });
    expect(deskFromTradeZero(parseTradingDeskSnapshot(s, NOW)!)).toMatchObject({ accountType: "Paper", staleAfterMs: 150_000, account: { equity: 2, buyingPower: null, dayPnl: null, dayRealized: null } });
  });
});

describe("#469 the P&L stream sends only its sign-in", () => {
  class FakeSocket {
    static last: FakeSocket;
    sent: string[] = [];
    listeners: Record<string, ((event: { data?: unknown }) => void)[]> = {};
    closed = false;
    constructor(public url: string) {
      FakeSocket.last = this;
    }
    addEventListener(type: string, fn: (event: { data?: unknown }) => void) {
      (this.listeners[type] ??= []).push(fn);
    }
    send(data: string) {
      this.sent.push(data);
    }
    close() {
      this.closed = true;
    }
    emit(type: string, data?: unknown) {
      for (const fn of this.listeners[type] ?? []) fn({ data });
    }
  }

  it("signs in once after PENDING_AUTH and then only listens", () => {
    const updates: unknown[] = [];
    const states: string[] = [];
    openPnlStream({ origin: "https://webapi.tradezero.com", keyId: "kid", secret: "sec", onPnl: (u: unknown) => updates.push(u), onState: (s: string) => states.push(s), WebSocketImpl: FakeSocket as unknown as typeof WebSocket });
    const ws = FakeSocket.last;
    expect(ws.url).toBe("wss://webapi.tradezero.com/stream/pnl");
    expect(ws.sent).toEqual([]);
    ws.emit("message", JSON.stringify({ status: "PENDING_AUTH" }));
    ws.emit("message", "PENDING_AUTH");
    ws.emit("message", JSON.stringify({ status: "CONNECTED" }));
    ws.emit("message", JSON.stringify({ accountValue: 38100, dayPnl: 310, pnl: [{ positionId: "ABCD", unrealizedPnL: 260 }] }));
    ws.emit("message", JSON.stringify({ type: "order", text: "anything" }));
    expect(ws.sent).toEqual([JSON.stringify({ key: "kid", secret: "sec" })]);
    expect(states).toEqual(["connecting", "connected"]);
    expect(updates).toEqual([{ values: { accountValue: 38100, dayPnl: 310 }, rows: [{ positionId: "ABCD", symbol: "", unrealizedPnL: 260, exposure: null, dayPnl: null }] }]);
  });

  it("stops on a refused key and refuses other stream addresses", () => {
    const states: string[] = [];
    openPnlStream({ origin: "http://127.0.0.1:9", keyId: "k", secret: "s", onState: (s: string) => states.push(s), WebSocketImpl: FakeSocket as unknown as typeof WebSocket });
    const ws = FakeSocket.last;
    expect(ws.url).toBe("ws://127.0.0.1:9/stream/pnl");
    ws.emit("message", "PENDING_AUTH");
    ws.emit("message", JSON.stringify({ error: "Unauthorized" }));
    expect(states).toEqual(["connecting", "refused"]);
    expect(ws.closed).toBe(true);
    expect(ws.sent).toHaveLength(1);
    expect(() => streamUrl("https://webapi.tradezero.com", "/stream/orders")).toThrow(/refused/);
  });
});

describe("#469 files, pace and backoff", () => {
  const dir = mkdtempSync(join(tmpdir(), "desk-feed-test-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const file = (name: string, text: string, mode: number) => {
    const path = join(dir, name);
    writeFileSync(path, text);
    chmodSync(path, mode);
    return path;
  };

  it("uses the first key file that exists, refuses one others can read, and needs all three values", () => {
    const good = file("good.env", "TRADEZERO_API_KEY_ID=a\nTRADEZERO_API_SECRET_KEY=b\nTRADEZERO_ACCOUNT_ID=c\n", 0o600);
    expect(loadTradeZeroKey([join(dir, "missing.env"), good])).toMatchObject({ keyId: "a", secret: "b", accountId: "c", file: good });
    const open = file("open.env", "TRADEZERO_API_KEY_ID=a\nTRADEZERO_API_SECRET_KEY=b\nTRADEZERO_ACCOUNT_ID=c\n", 0o644);
    expect(() => loadTradeZeroKey([open, good])).toThrow(/chmod 600/);
    const partial = file("partial.env", "TZ_API_KEY_ID=a\n", 0o600);
    expect(() => loadTradeZeroKey([partial])).toThrow(/no TradeZero secret, account id/);
    expect(() => loadTradeZeroKey([join(dir, "none.env")])).toThrow(/no TradeZero key file/);
  });

  it("reads the token only from a private file, and only a real token", () => {
    expect(loadToken(file("feed.token", `${TOKEN}\n`, 0o600))).toBe(TOKEN);
    expect(() => loadToken(file("open.token", TOKEN, 0o640))).toThrow(/chmod 600/);
    expect(() => loadToken(file("short.token", "abc", 0o600))).toThrow(/doesn't hold a token/);
    expect(() => loadToken(join(dir, "nope.token"))).toThrow(/can't be read/);
  });

  it("reads every 5 s from 4 AM to 8 PM New York on weekdays, else every 60 s, and backs off on failures", () => {
    expect(marketHours(Date.parse("2026-11-19T09:00:00Z"))).toBe(true); // 4:00 AM
    expect(marketHours(Date.parse("2026-11-19T08:59:00Z"))).toBe(false);
    expect(marketHours(Date.parse("2026-11-20T00:59:00Z"))).toBe(true); // 7:59 PM Thursday
    expect(marketHours(Date.parse("2026-11-20T01:00:00Z"))).toBe(false); // 8:00 PM
    expect(marketHours(Date.parse("2026-11-21T15:00:00Z"))).toBe(false); // Saturday
    expect(nextWait({ ok: true, failures: 0, pollEveryMs: 5_000 })).toBe(5_000);
    expect([1, 2, 3, 4, 5, 6, 9].map((failures) => nextWait({ ok: false, failures, pollEveryMs: 5_000 }))).toEqual([10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000]);
    expect(nextWait({ ok: false, failures: 1, pollEveryMs: 60_000 })).toBe(60_000);
    expect(nextWait({ ok: false, failures: 1, pollEveryMs: 5_000, status: 401 })).toBe(300_000);
  });
});
