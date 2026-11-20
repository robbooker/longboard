// #469 Trading Desk feed: a TradeZero client that can only READ.
//
// HARD RULE: every request goes through readOnlyRequest(), which refuses anything that is not a GET to
// one of exactly five addresses, built from the configured account:
//   GET /v1/api/accounts
//   GET /v1/api/account/{accountId}
//   GET /v1/api/accounts/{accountId}/positions
//   GET /v1/api/accounts/{accountId}/pnl
//   GET /v1/api/accounts/{accountId}/orders
// No other method (POST, PUT, PATCH, DELETE, ...), no other address (orders by id, locates, routes,
// anything with a query string), never a request body. So it cannot place, change or cancel an order
// or touch a locate. lib/__tests__/tradingDeskFeedGuard.test.ts checks the guard and this folder's
// source for any write.
//
// Limits: the key is shared with the borrow lookup (scripts/gainers-lookup), so this client keeps
// well under TradeZero's per-key limits (orders 2/s, positions and pnl 3/s): one request at a time,
// at least 1 s apart. A 429 waits 2 s and tries once more, then gives up so the feed backs off.
// Node 22+, no packages. The key and secret are only ever put in the two request headers; the account
// number is never in an error message.

export const BASE_URL = "https://webapi.tradezero.com";
export const REQUEST_GAP_MS = 1_000;
const RETRY_429_MS = 2_000;
const TIMEOUT_MS = 15_000;
const ACCOUNT = /^[A-Za-z0-9]{1,32}$/;

export class TradeZeroError extends Error {
  constructor(message, status = null) {
    super(message);
    this.status = status;
  }
}

/** The five read-only addresses for one account, exactly. */
export function readOnlyPaths(accountId) {
  if (!ACCOUNT.test(String(accountId ?? ""))) throw new TradeZeroError("the TradeZero account id must be letters and digits");
  const a = encodeURIComponent(accountId);
  return Object.freeze({
    accounts: "/v1/api/accounts",
    account: `/v1/api/account/${a}`,
    positions: `/v1/api/accounts/${a}/positions`,
    pnl: `/v1/api/accounts/${a}/pnl`,
    orders: `/v1/api/accounts/${a}/orders`,
  });
}

/**
 * Throws unless this is a GET, with no body, to one of the five read-only addresses (exact match: no
 * query, no trailing slash, no other account). Called on every request before anything is sent.
 */
export function assertReadOnly(method, path, accountId, body = undefined) {
  if (method !== "GET") throw new TradeZeroError(`refused: only GET is allowed, not ${String(method).slice(0, 10)}`);
  if (body !== undefined && body !== null) throw new TradeZeroError("refused: a read never carries a body");
  if (typeof path !== "string" || !Object.values(readOnlyPaths(accountId)).includes(path))
    throw new TradeZeroError("refused: that address is not on the read-only list");
  if (/locate/i.test(path)) throw new TradeZeroError("refused: never a locate");
}

/** True when assertReadOnly would let the request through. */
export function isReadOnlyRequest(method, path, accountId, body) {
  try {
    assertReadOnly(method, path, accountId, body);
    return true;
  } catch {
    return false;
  }
}

/** TradeZero's address, or a local fake server for tests. Anything else is refused (the key would go there). */
export function checkBaseUrl(baseUrl = BASE_URL) {
  let url;
  try {
    url = new URL(String(baseUrl));
  } catch {
    throw new TradeZeroError("the TradeZero address is not an address");
  }
  const local = url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  const real = url.protocol === "https:" && url.hostname === "webapi.tradezero.com" && !url.port;
  if (!local && !real) throw new TradeZeroError("the TradeZero address must be https://webapi.tradezero.com");
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password)
    throw new TradeZeroError("the TradeZero address must be just the host");
  return url.origin;
}

/**
 * The read-only client: accounts, account, positions, pnl and orders, nothing else.
 * fetch, now and sleep are passed in by the tests.
 */
export function createReadOnlyClient({
  keyId,
  secret,
  accountId,
  baseUrl = BASE_URL,
  fetch = globalThis.fetch,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  gapMs = REQUEST_GAP_MS,
}) {
  if (!keyId || !secret || !accountId) throw new TradeZeroError("TradeZero key, secret and account are all needed");
  const origin = checkBaseUrl(baseUrl);
  const paths = readOnlyPaths(accountId);
  const headers = Object.freeze({ "TZ-API-KEY-ID": keyId, "TZ-API-SECRET-KEY": secret, accept: "application/json" });
  let lastRequest = -Infinity;
  let queue = Promise.resolve();

  /** The only way this program talks to TradeZero's REST API. */
  function readOnlyRequest(method, path, body) {
    const run = async () => {
      assertReadOnly(method, path, accountId, body);
      const url = new URL(path, origin);
      // Belt and braces: what goes out is exactly the checked address on the checked host.
      if (url.origin !== origin || url.pathname !== path || url.search) throw new TradeZeroError("refused: address changed");
      for (let attempt = 0; ; attempt++) {
        for (let wait = lastRequest + gapMs - now(); wait > 0; wait = lastRequest + gapMs - now()) await sleep(wait);
        lastRequest = now();
        let response;
        try {
          response = await fetch(url.href, { method: "GET", headers, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
        } catch (error) {
          throw new TradeZeroError(`TradeZero unreachable (${error?.name ?? "error"})`);
        }
        if (response.status === 429 && attempt === 0) {
          await sleep(RETRY_429_MS);
          continue;
        }
        if (response.status === 429) throw new TradeZeroError("TradeZero said slow down (429)", 429);
        if (response.status === 401 || response.status === 403) throw new TradeZeroError("TradeZero refused the key", response.status);
        if (!response.ok) throw new TradeZeroError(`TradeZero answered ${response.status}`, response.status);
        try {
          return await response.json();
        } catch {
          throw new TradeZeroError("TradeZero answered with something other than JSON", response.status);
        }
      }
    };
    const result = queue.then(run, run);
    queue = result.catch(() => {});
    return result;
  }

  return Object.freeze({
    accounts: () => readOnlyRequest("GET", paths.accounts),
    account: () => readOnlyRequest("GET", paths.account),
    positions: () => readOnlyRequest("GET", paths.positions),
    pnl: () => readOnlyRequest("GET", paths.pnl),
    orders: () => readOnlyRequest("GET", paths.orders),
    /** For the guard's tests: the same gate every read goes through. */
    _request: readOnlyRequest,
  });
}
