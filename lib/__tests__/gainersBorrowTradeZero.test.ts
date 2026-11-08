import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  allowedRequest,
  checkBorrow,
  createTradeZeroClient,
  readOffer,
  tzSymbol,
} from "../../scripts/gainers-lookup/tradezero.mjs";

// #373: the TradeZero borrow client against a fake fetch and a fake clock. No real request is sent.
type Call = { method: string; url: string; body: Record<string, unknown> | null; at: number };
type Reply = { status?: number; body?: unknown } | ((call: Call) => { status?: number; body?: unknown });

function harness(routes: { etb?: Reply; quote?: Reply; history?: Reply[] }) {
  let t = 1_000_000;
  const calls: Call[] = [];
  const history = [...(routes.history ?? [])];
  const now = () => t;
  const sleep = async (ms: number) => {
    t += ms;
  };
  const fetch = async (url: string, init: RequestInit) => {
    const call = { method: init.method ?? "GET", url, body: init.body ? JSON.parse(String(init.body)) : null, at: t };
    calls.push(call);
    const path = new URL(url).pathname;
    let reply: Reply | undefined;
    if (path.includes("/is-easy-to-borrow/")) reply = routes.etb;
    else if (path.endsWith("/locates/quote")) reply = routes.quote ?? { body: { locateQuoteSent: "true" } };
    else if (path.endsWith("/locates/history")) reply = history.length > 1 ? history.shift() : history[0];
    const r = typeof reply === "function" ? reply(call) : (reply ?? { status: 404, body: {} });
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  };
  let n = 0;
  const client = createTradeZeroClient({
    keyId: "synthetic-key-id",
    secret: "synthetic-secret",
    accountId: "TESTACCT1",
    fetch: fetch as typeof globalThis.fetch,
    now,
    sleep,
    newId: () => `q${++n}`,
  });
  return { client, calls, now, sleep, advance: (ms: number) => (t += ms) };
}

const row = (quoteReqID: string, locateStatus: number, locatePrice = 0, locateType = 1) => ({
  quoteReqID,
  symbol: "ABCD",
  locateStatus,
  locatePrice,
  locateType,
  locateShares: 100,
});

describe("TradeZero borrow check (#373)", () => {
  it("easy to borrow: one free read, no quote", async () => {
    const h = harness({ etb: { body: { isEasyToBorrow: true } } });
    const result = await checkBorrow(h.client, "ABCD", { now: h.now, sleep: h.sleep });
    expect(result).toEqual({ kind: "borrow", ticker: "ABCD", status: "etb", etb: true, pricePerShare: null, locateType: null });
    expect(h.calls.map((c) => [c.method, new URL(c.url).pathname])).toEqual([
      ["GET", "/v1/api/accounts/TESTACCT1/is-easy-to-borrow/symbol/ABCD"],
    ]);
    expect(h.calls[0].url.startsWith("https://webapi.tradezero.com/")).toBe(true);
  });

  it("sends the key headers", async () => {
    let headers: Headers | null = null;
    const client = createTradeZeroClient({
      keyId: "kid",
      secret: "sec",
      accountId: "A1",
      fetch: (async (_url: string, init: RequestInit) => {
        headers = new Headers(init.headers);
        return new Response('{"isEasyToBorrow":false}');
      }) as typeof globalThis.fetch,
    });
    expect(await client.isEasyToBorrow("XYZ")).toBe(false);
    expect(headers!.get("TZ-API-KEY-ID")).toBe("kid");
    expect(headers!.get("TZ-API-SECRET-KEY")).toBe("sec");
  });

  it("hard to borrow: quotes 100 shares and reads the offered price from the history", async () => {
    const h = harness({
      etb: { body: { isEasyToBorrow: false } },
      history: [
        { body: { locateHistory: [row("older", 65, 0.5)] } },
        { body: { locateHistory: [row("q1", 54)] } },
        { body: { locateHistory: [row("q1", 65, 0.04), row("older", 65, 0.01)] } },
      ],
    });
    const result = await checkBorrow(h.client, "ABCD", { now: h.now, sleep: h.sleep });
    expect(result).toEqual({ kind: "borrow", ticker: "ABCD", status: "offered", etb: false, pricePerShare: 0.04, locateType: "Locate" });
    const quote = h.calls.find((c) => c.method === "POST")!;
    expect(new URL(quote.url).pathname).toBe("/v1/api/accounts/locates/quote");
    expect(quote.body).toEqual({ account: "TESTACCT1", symbol: "ABCD", quantity: 100, quoteReqID: "q1" });
    expect(h.calls.filter((c) => c.url.endsWith("/locates/history"))).toHaveLength(3);
    expect(h.calls.every((c) => c.method === "GET" || c.url.endsWith("/locates/quote"))).toBe(true);
  });

  it("Reg SHO pair: keeps the cheaper of the pre-borrow and single-use offers, with its type", async () => {
    const h = harness({
      etb: { body: { isEasyToBorrow: false } },
      history: [{ body: [row("q1", 65, 0.12, 3), row("q1.SU", 65, 0.0725, 4)] }],
    });
    expect(await checkBorrow(h.client, "ABCD", { now: h.now, sleep: h.sleep })).toMatchObject({
      status: "offered",
      pricePerShare: 0.0725,
      locateType: "SingleUse",
    });
    expect(readOffer([row("q9", 65, 0.03, 3), row("q9.SU", 65, 0.05, 4)], "q9")).toEqual({
      state: "offered",
      pricePerShare: 0.03,
      locateType: "PreBorrow",
    });
    // One offered and one rejected: the offer counts.
    expect(readOffer([row("q9", 56), row("q9.SU", 65, 0.05, 4)], "q9")).toMatchObject({ state: "offered", locateType: "SingleUse" });
    // A row for another quote whose id merely starts the same doesn't count.
    expect(readOffer([row("q91", 65, 0.05)], "q9")).toEqual({ state: "waiting" });
  });

  it("rejected or expired: none available", async () => {
    const h = harness({ etb: { body: { isEasyToBorrow: false } }, history: [{ body: { locateHistory: [row("q1", 56)] } }] });
    expect(await checkBorrow(h.client, "ABCD", { now: h.now, sleep: h.sleep })).toEqual({
      kind: "borrow",
      ticker: "ABCD",
      status: "none",
      etb: false,
      pricePerShare: null,
      locateType: null,
    });
    expect(readOffer([row("q1", 67), row("q1.SU", 56)], "q1")).toEqual({ state: "none" });
    expect(readOffer([row("q1", 65, 0)], "q1")).toEqual({ state: "waiting" });
  });

  it("no answer within 20 seconds: an error, and it stops asking", async () => {
    const h = harness({ etb: { body: { isEasyToBorrow: false } }, history: [{ body: { locateHistory: [row("q1", 54)] } }] });
    const started = h.now();
    const result = await checkBorrow(h.client, "ABCD", { now: h.now, sleep: h.sleep });
    expect(result).toMatchObject({ status: "error", etb: false, pricePerShare: null, reason: "no answer in time" });
    expect(h.now() - started).toBeLessThanOrEqual(25_000);
    expect(h.calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("errors: a refused key, a server error, an odd answer", async () => {
    const refused = harness({ etb: { status: 401 } });
    expect(await checkBorrow(refused.client, "ABCD", { now: refused.now, sleep: refused.sleep })).toMatchObject({
      status: "error",
      etb: null,
      reason: "TradeZero refused the key",
    });
    const odd = harness({ etb: { body: { something: 1 } } });
    expect(await checkBorrow(odd.client, "ABCD", { now: odd.now, sleep: odd.sleep })).toMatchObject({ status: "error" });
    const down = harness({ etb: { body: { isEasyToBorrow: false } }, quote: { status: 500 } });
    expect(await checkBorrow(down.client, "ABCD", { now: down.now, sleep: down.sleep })).toMatchObject({ status: "error", etb: false });
  });

  it("waits and tries again on a 429", async () => {
    let first = true;
    const h = harness({
      etb: () => {
        if (first) {
          first = false;
          return { status: 429 };
        }
        return { body: { isEasyToBorrow: true } };
      },
    });
    expect(await h.client.isEasyToBorrow("ABCD")).toBe(true);
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1].at - h.calls[0].at).toBeGreaterThanOrEqual(1_500);
  });

  it("keeps 2 seconds between quotes and 30 seconds between quotes for the same symbol", async () => {
    const h = harness({ history: [{ body: [] }] });
    await h.client.requestQuote("AAA");
    await h.client.requestQuote("BBB");
    await h.client.requestQuote("AAA");
    const quotes = h.calls.filter((c) => c.method === "POST");
    expect(quotes.map((c) => c.body!.symbol)).toEqual(["AAA", "BBB", "AAA"]);
    expect(quotes[1].at - quotes[0].at).toBeGreaterThanOrEqual(2_000);
    expect(quotes[2].at - quotes[0].at).toBeGreaterThanOrEqual(30_000);
    // Reads are spaced too (TradeZero allows 2 a second).
    await h.client.locateHistory();
    await h.client.locateHistory();
    const reads = h.calls.filter((c) => c.method === "GET");
    expect(reads[1].at - reads[0].at).toBeGreaterThanOrEqual(600);
  });

  it("writes symbols the way TradeZero does and refuses bad ones", () => {
    expect(tzSymbol("BRK B")).toBe("BRK.B");
    expect(() => tzSymbol("../x")).toThrow();
    expect(() => tzSymbol("")).toThrow();
  });
});

describe("the borrow check never takes a locate (#373 hard rule)", () => {
  const dir = join(__dirname, "../../scripts/gainers-lookup");
  const source = readFileSync(join(dir, "tradezero.mjs"), "utf8");

  it("the client has exactly three requests: easy to borrow, quote, history", () => {
    const h = harness({});
    expect(Object.keys(h.client).sort()).toEqual(["isEasyToBorrow", "locateHistory", "requestQuote"]);
    expect(Object.isFrozen(h.client)).toBe(true);
  });

  it("no address in the client's source but those three, and no word for taking, selling or withdrawing a locate", () => {
    expect(source).not.toMatch(/accept/i);
    expect(source).not.toMatch(/\bsell\b|\/sell|locates\/sell/i);
    expect(source).not.toMatch(/cancel/i);
    expect(source).not.toMatch(/["'`](DELETE|PUT|PATCH)["'`]/);
    const locatePaths = [...source.matchAll(/locates\/([a-z-]+)/gi)].map((m) => m[1]);
    expect(new Set(locatePaths)).toEqual(new Set(["quote", "history"]));
  });

  it("nothing else in the lookup program reaches a locate address either", () => {
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".mjs") && f !== "tradezero.mjs")) {
      const text = readFileSync(join(dir, file), "utf8");
      expect(text, file).not.toMatch(/locates\/|webapi\.tradezero|TZ-API/i);
    }
  });

  it("refuses at run time anything outside the allowed list", () => {
    expect(allowedRequest("GET", "/v1/api/accounts/A1/is-easy-to-borrow/symbol/ABCD")).toBe(true);
    expect(allowedRequest("POST", "/v1/api/accounts/locates/quote")).toBe(true);
    expect(allowedRequest("GET", "/v1/api/accounts/A1/locates/history")).toBe(true);
    for (const [method, path] of [
      ["POST", "/v1/api/accounts/locates/" + "acc" + "ept"],
      ["POST", "/v1/api/accounts/locates/" + "se" + "ll"],
      ["DELETE", "/v1/api/accounts/A1/locates/" + "can" + "cel/q1"],
      ["GET", "/v1/api/accounts/locates/quote"],
      ["POST", "/v1/api/accounts/A1/locates/history"],
      ["POST", "/v1/api/accounts/A1/order"],
      ["GET", "/v1/api/accounts/A1/locates/history/../../order"],
    ])
      expect(allowedRequest(method, path), `${method} ${path}`).toBe(false);
  });
});
