import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertReadOnly,
  checkBaseUrl,
  createReadOnlyClient,
  isReadOnlyRequest,
  readOnlyPaths,
} from "../../scripts/trading-desk-feed/tz-readonly.mjs";

// #469 The Trading Desk feed's TradeZero client can only read. These tests are the main safety: the
// key it uses is a LIVE key. No real request is sent; fetch is a fake that records what it was asked.
const ACCT = "TESTACCT1";
const P = readOnlyPaths(ACCT);
const ALLOWED = [
  "/v1/api/accounts",
  `/v1/api/account/${ACCT}`,
  `/v1/api/accounts/${ACCT}/positions`,
  `/v1/api/accounts/${ACCT}/pnl`,
  `/v1/api/accounts/${ACCT}/orders`,
];
const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "CONNECT", "TRACE", "get", "Get", " GET", "GET ", "", undefined, null];
// Every write and every other read TradeZero documents, plus near misses of the allowed five.
const REFUSED_PATHS = [
  "/v1/api/accounts/locates/quote",
  "/v1/api/accounts/locates/accept",
  "/v1/api/accounts/locates/sell",
  `/v1/api/accounts/${ACCT}/locates/history`,
  `/v1/api/accounts/${ACCT}/locates/inventory`,
  `/v1/api/accounts/${ACCT}/locates/cancel`,
  `/v1/api/accounts/${ACCT}/is-easy-to-borrow/symbol/AAPL`,
  `/v1/api/accounts/${ACCT}/order`,
  `/v1/api/accounts/${ACCT}/order/abc123`,
  `/v1/api/accounts/${ACCT}/orders/abc123`,
  `/v1/api/accounts/${ACCT}/orders/cancel-all`,
  `/v1/api/accounts/${ACCT}/orders-with-pagination/start-date/2026-11-01`,
  `/v1/api/accounts/${ACCT}/orders/start-date/2026-11-01`,
  `/v1/api/accounts/${ACCT}/routes`,
  "/v1/api/order",
  "/v1/api/orders",
  `/v1/api/accounts/OTHERACCT/positions`,
  `/v1/api/account/OTHERACCT`,
  `/v1/api/accounts/${ACCT}/positions/`,
  `/v1/api/accounts/${ACCT}/positions?x=1`,
  `/v1/api/accounts/${ACCT}/positions#x`,
  `/v1/api/accounts/${ACCT}/pnl/../orders/abc`,
  `/v1/api/accounts/${ACCT}/../locates/history`,
  `//v1/api/accounts/${ACCT}/orders`,
  `/v1/api/accounts/${ACCT}//orders`,
  `/V1/API/ACCOUNTS/${ACCT}/ORDERS`,
  `/v1/api/accounts/${ACCT.toLowerCase()}/orders`,
  `/v1/api/accounts/${ACCT}/orders%2Fabc`,
  `/v1/api/accounts/${ACCT}%2Flocates%2Fhistory`,
  `https://webapi.tradezero.com/v1/api/accounts/${ACCT}/orders`,
  `v1/api/accounts/${ACCT}/orders`,
  "/v1/api/accounts/",
  "/",
  "",
  "/stream/pnl",
];

describe("#469 the GET-only gate", () => {
  it("lets through exactly the five reads, as GET with no body", () => {
    expect(Object.values(P)).toEqual(ALLOWED);
    for (const path of ALLOWED) {
      expect(() => assertReadOnly("GET", path, ACCT)).not.toThrow();
      expect(isReadOnlyRequest("GET", path, ACCT)).toBe(true);
    }
  });

  it("refuses every other method on every allowed address", () => {
    for (const path of ALLOWED)
      for (const method of WRITE_METHODS) {
        expect(() => assertReadOnly(method, path, ACCT), `${method} ${path}`).toThrow(/refused/);
        expect(isReadOnlyRequest(method, path, ACCT)).toBe(false);
      }
  });

  it("refuses GET to any other address: locates, single orders, other accounts, tricks", () => {
    for (const path of REFUSED_PATHS) expect(() => assertReadOnly("GET", path, ACCT), path).toThrow(/refused/);
    for (const path of [null, undefined, 42, {}, ["/v1/api/accounts"]]) expect(isReadOnlyRequest("GET", path, ACCT)).toBe(false);
  });

  it("refuses writes to locate and order addresses whatever the method", () => {
    for (const path of REFUSED_PATHS.slice(0, 16))
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) expect(isReadOnlyRequest(method, path, ACCT), `${method} ${path}`).toBe(false);
  });

  it("refuses a body, even on an allowed GET", () => {
    for (const body of ["{}", "x", {}, { account: ACCT }, 0, ""] as unknown[]) expect(() => assertReadOnly("GET", P.orders, ACCT, body as undefined)).toThrow(/body/);
  });

  it("builds the addresses only for a plain account id", () => {
    for (const bad of ["", "../x", "a/b", "A B", "acct?x=1", "acct#", "%2e%2e", "x".repeat(33), null, undefined])
      expect(() => readOnlyPaths(bad), String(bad)).toThrow();
    expect(() => assertReadOnly("GET", "/v1/api/accounts", "../x")).toThrow();
  });

  it("never says the account number in a refusal", () => {
    try {
      assertReadOnly("DELETE", P.orders, ACCT);
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(ACCT);
    }
    try {
      assertReadOnly("GET", `/v1/api/accounts/${ACCT}/locates/history`, ACCT);
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(ACCT);
    }
  });

  it("sends the key only to TradeZero's host (or a test server on this computer)", () => {
    expect(checkBaseUrl("https://webapi.tradezero.com")).toBe("https://webapi.tradezero.com");
    expect(checkBaseUrl("https://webapi.tradezero.com/")).toBe("https://webapi.tradezero.com");
    expect(checkBaseUrl("http://127.0.0.1:5123")).toBe("http://127.0.0.1:5123");
    for (const bad of [
      "http://webapi.tradezero.com",
      "https://webapi.tradezero.com.example.test",
      "https://example.test",
      "https://webapi.tradezero.com:8443",
      "https://webapi.tradezero.com/v1/api",
      "https://user:pass@webapi.tradezero.com",
      "https://webapi.tradezero.com/?x=1",
      "http://10.0.0.5",
      "ftp://127.0.0.1",
      "not a url",
    ])
      expect(() => checkBaseUrl(bad), bad).toThrow();
  });
});

describe("#469 the read-only client", () => {
  type Seen = { url: string; method: string | undefined; body: unknown; headers: Record<string, string>; redirect: string | undefined };
  function client(reply: (url: string) => { status?: number; body?: unknown } = () => ({ body: {} })) {
    let t = 0;
    const seen: Seen[] = [];
    const fetch = async (url: string, init: RequestInit) => {
      seen.push({ url, method: init.method, body: init.body, headers: init.headers as Record<string, string>, redirect: init.redirect });
      const r = reply(url);
      return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
    };
    const c = createReadOnlyClient({
      keyId: "synthetic-key-id",
      secret: "synthetic-secret",
      accountId: ACCT,
      fetch: fetch as typeof globalThis.fetch,
      now: () => t,
      sleep: async (ms: number) => {
        t += ms;
      },
    });
    return { c, seen, now: () => t };
  }

  it("has only the five reads, each a GET with the key headers, no body, no redirects", async () => {
    const { c, seen } = client();
    expect(Object.keys(c).sort()).toEqual(["_request", "account", "accounts", "orders", "pnl", "positions"]);
    await c.accounts();
    await c.account();
    await c.positions();
    await c.pnl();
    await c.orders();
    expect(seen.map((s) => s.url)).toEqual(ALLOWED.map((path) => `https://webapi.tradezero.com${path}`));
    for (const s of seen) {
      expect(s.method).toBe("GET");
      expect(s.body).toBeUndefined();
      expect(s.redirect).toBe("error");
      expect(s.headers["TZ-API-KEY-ID"]).toBe("synthetic-key-id");
      expect(s.headers["TZ-API-SECRET-KEY"]).toBe("synthetic-secret");
    }
  });

  it("sends nothing at all for a write or another address", async () => {
    const { c, seen } = client();
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) await expect(c._request(method, P.orders)).rejects.toThrow(/refused/);
    await expect(c._request("GET", P.orders, "{}")).rejects.toThrow(/refused/);
    for (const path of REFUSED_PATHS) await expect(c._request("GET", path)).rejects.toThrow(/refused/);
    expect(seen).toEqual([]);
  });

  it("keeps at least a second between requests (the key is shared with the borrow lookup)", async () => {
    const times: number[] = [];
    let t = 0;
    const c = createReadOnlyClient({
      keyId: "k",
      secret: "s",
      accountId: ACCT,
      fetch: (async () => {
        times.push(t);
        return new Response("{}");
      }) as unknown as typeof globalThis.fetch,
      now: () => t,
      sleep: async (ms: number) => {
        t += ms;
      },
    });
    await Promise.all([c.account(), c.positions(), c.pnl(), c.orders()]);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(1_000);
  });

  it("on a 429 waits and tries once more, then gives up with the status (the feed backs off)", async () => {
    let calls = 0;
    const { c, now } = client(() => (++calls, { status: 429 }));
    await expect(c.orders()).rejects.toMatchObject({ status: 429 });
    expect(calls).toBe(2);
    expect(now()).toBeGreaterThanOrEqual(2_000);
    let n = 0;
    const second = client(() => (++n === 1 ? { status: 429 } : { body: [] }));
    await expect(second.c.orders()).resolves.toEqual([]);
  });

  it("names a refused key or an error without the key, the secret or the account number", async () => {
    for (const status of [401, 403, 500]) {
      const { c } = client(() => ({ status }));
      const error = await c.positions().catch((e: Error) => e);
      expect(error).toBeInstanceOf(Error);
      for (const secret of ["synthetic-key-id", "synthetic-secret", ACCT]) expect((error as Error).message).not.toContain(secret);
    }
  });
});

describe("#469 the feed's code has no way to write", () => {
  const dir = join(process.cwd(), "scripts/trading-desk-feed");
  const files = readdirSync(dir).filter((f) => f.endsWith(".mjs"));
  const source = (f: string) => readFileSync(join(dir, f), "utf8");
  const code = (f: string) => source(f).replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

  it("names no locate, single-order, routes or borrow address", () => {
    for (const f of files)
      expect(code(f), f).not.toMatch(/locates|\/order\/|\/order"|orders-with|start-date|\/routes|is-easy-to-borrow/i);
  });

  it("sends TradeZero only GET: the one fetch to TradeZero is method GET, no body", () => {
    const tz = code("tz-readonly.mjs");
    expect(tz.match(/fetch\(/g)?.length).toBe(1);
    expect(tz).toMatch(/fetch\(url\.href, \{ method: "GET", headers, redirect: "error"/);
    expect(tz).not.toMatch(/body:/);
    expect(tz).not.toMatch(/"(POST|PUT|PATCH|DELETE)"/);
    // The only other request in the folder is the snapshot going to the chat.
    const feed = code("feed.mjs");
    expect(feed.match(/fetchImpl\(|fetch\(/g)?.length).toBe(1);
    expect(feed).toMatch(/fetchImpl\(`\$\{base\}\/api\/chat\/trading-desk\/feed`/);
    for (const f of files.filter((f) => !["tz-readonly.mjs", "feed.mjs"].includes(f))) expect(code(f), f).not.toMatch(/fetch\(/);
  });

  it("writes to the stream only once, the sign-in", () => {
    const sends = files.flatMap((f) => (code(f).match(/\.send\(/g) ?? []).map(() => f));
    expect(sends).toEqual(["stream.mjs"]);
    expect(code("stream.mjs")).toMatch(/ws\.send\(JSON\.stringify\(MESSAGES\[kind\]\(\)\)\)/);
    expect(code("stream.mjs")).toMatch(/const MESSAGES = \{ auth: \(\) => \(\{ key: keyId, secret \}\), subscribe: \(\) => \(\{ account: accountId \}\) \};/);
  });

  it("loads no other TradeZero client (the borrow lookup's can ask for quotes)", () => {
    for (const f of files) {
      const imports = [...source(f).matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
      for (const from of imports) expect(from, `${f} imports ${from}`).toMatch(/^(node:|\.\/(snapshot|stream|tz-readonly)\.mjs$|\.\.\/gainers-lookup\/tz-env\.mjs$)/);
    }
    expect(readFileSync(join(dir, "../gainers-lookup/tz-env.mjs"), "utf8")).not.toMatch(/^import /m);
  });
});
