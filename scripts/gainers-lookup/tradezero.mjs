// #373 Gainers Table: what it costs to borrow a stock at TradeZero, per share. Rob, the account
// owner, has TradeZero's express written permission to build an application that shows borrow costs.
//
// HARD RULE: this program only ever ASKS for a price. The client below has exactly three requests:
//   1. GET  /v1/api/accounts/{account}/is-easy-to-borrow/symbol/{symbol}  (free; ETB needs no locate)
//   2. POST /v1/api/accounts/locates/quote                                (asks for an offer; ack only)
//   3. GET  /v1/api/accounts/{account}/locates/history                    (reads the offer)
// It never takes an offer or touches a locate in any other way; offers are left to run out on their
// own (letting an offer lapse costs nothing). lib/__tests__/gainersBorrowTradeZero.test.ts checks
// this file's source for any other locate address, and every request is checked against the three
// addresses above before it goes out.
//
// Limits (TradeZero's, with room to spare): a quote at most every 2 seconds overall (theirs: 1/s)
// and at least 30 seconds between two quotes for the same symbol; every request at least 0.6 s
// after the last (theirs: 2/s for the reads). A 429 waits and tries again a couple of times.
// Node 22+, no packages. The key and secret are never printed.

export const BASE_URL = "https://webapi.tradezero.com";
export const QUOTE_SHARES = 100;
export const QUOTE_GAP_MS = 2_000;
export const SAME_SYMBOL_GAP_MS = 30_000;
export const REQUEST_GAP_MS = 600;
export const POLL_MS = 1_500;
export const OFFER_WAIT_MS = 20_000;
const RETRY_429_MS = [1_500, 2_500];
const SYMBOL = /^[A-Z][A-Z0-9.]{0,9}$/;

// locateStatus values in the history.
const OFFERED = 65;
const ENDED_WITHOUT_OFFER = new Set([52, 56, 67]); // withdrawn, rejected, expired
const TYPE_NAMES = { 1: "Locate", 2: "Locate", 3: "PreBorrow", 4: "SingleUse" };

/** The only requests this program may send: method and address shape. */
const ALLOWED = [
  ["GET", /^\/v1\/api\/accounts\/[^/]+\/is-easy-to-borrow\/symbol\/[A-Z][A-Z0-9.]{0,9}$/],
  ["POST", /^\/v1\/api\/accounts\/locates\/quote$/],
  ["GET", /^\/v1\/api\/accounts\/[^/]+\/locates\/history$/],
];
export function allowedRequest(method, path) {
  return ALLOWED.some(([m, re]) => m === method && re.test(path));
}

export class TradeZeroError extends Error {
  constructor(message, status = null) {
    super(message);
    this.status = status;
  }
}

/** A symbol as TradeZero writes it ("BRK.B"); the table's "BRK B" style becomes a dot. */
export function tzSymbol(ticker) {
  const symbol = String(ticker).trim().toUpperCase().replace(/ /g, ".");
  if (!SYMBOL.test(symbol)) throw new TradeZeroError("bad symbol");
  return symbol;
}

/**
 * The TradeZero client: isEasyToBorrow, requestQuote and locateHistory, nothing else.
 * fetch, now, sleep and newId are passed in by the tests.
 */
export function createTradeZeroClient({
  keyId,
  secret,
  accountId,
  baseUrl = BASE_URL,
  fetch = globalThis.fetch,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  newId = () => crypto.randomUUID().replace(/-/g, ""),
}) {
  if (!keyId || !secret || !accountId) throw new TradeZeroError("TradeZero key, secret and account are all needed");
  const base = String(baseUrl).replace(/\/$/, "");
  if (new URL(base).protocol !== "https:") throw new TradeZeroError("TradeZero address must be https");
  const account = encodeURIComponent(accountId);
  const headers = { "TZ-API-KEY-ID": keyId, "TZ-API-SECRET-KEY": secret };
  let lastRequest = -Infinity;
  let lastQuote = -Infinity;
  const lastQuoteBySymbol = new Map();
  // One request at a time, so the gaps hold even if two checks overlap.
  let queue = Promise.resolve();

  const waitUntil = async (at) => {
    for (let wait = at - now(); wait > 0; wait = at - now()) await sleep(wait);
  };

  function send(method, path, body) {
    const run = async () => {
      if (!allowedRequest(method, path)) throw new TradeZeroError(`refused to send ${method} ${path}`);
      for (let attempt = 0; ; attempt++) {
        await waitUntil(lastRequest + REQUEST_GAP_MS);
        lastRequest = now();
        let response;
        try {
          response = await fetch(`${base}${path}`, {
            method,
            headers: body ? { ...headers, "content-type": "application/json" } : headers,
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(15_000),
          });
        } catch (error) {
          throw new TradeZeroError(`TradeZero unreachable (${error?.name ?? "error"})`);
        }
        if (response.status === 429 && attempt < RETRY_429_MS.length) {
          await sleep(RETRY_429_MS[attempt]);
          continue;
        }
        if (response.status === 401 || response.status === 403)
          throw new TradeZeroError("TradeZero refused the key", response.status);
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
    /** True when TradeZero lists the stock as easy to borrow (no locate needed). */
    async isEasyToBorrow(ticker) {
      const symbol = tzSymbol(ticker);
      const body = await send("GET", `/v1/api/accounts/${account}/is-easy-to-borrow/symbol/${encodeURIComponent(symbol)}`);
      if (typeof body?.isEasyToBorrow !== "boolean") throw new TradeZeroError("unexpected easy-to-borrow answer");
      return body.isEasyToBorrow;
    },
    /** Asks for an offer on 100 shares; returns the quote's id. TradeZero only acknowledges it. */
    async requestQuote(ticker) {
      const symbol = tzSymbol(ticker);
      await waitUntil(Math.max(lastQuote + QUOTE_GAP_MS, (lastQuoteBySymbol.get(symbol) ?? -Infinity) + SAME_SYMBOL_GAP_MS));
      const quoteReqID = newId();
      lastQuote = now();
      lastQuoteBySymbol.set(symbol, lastQuote);
      await send("POST", "/v1/api/accounts/locates/quote", { account: accountId, symbol, quantity: QUOTE_SHARES, quoteReqID });
      return quoteReqID;
    },
    /** The account's locate history rows. */
    async locateHistory() {
      return historyRows(await send("GET", `/v1/api/accounts/${account}/locates/history`));
    },
  });
}

export function historyRows(body) {
  const rows = Array.isArray(body) ? body : Array.isArray(body?.locateHistory) ? body.locateHistory : [];
  return rows.filter((row) => row && typeof row === "object");
}

const int = (value) => (value === null || value === undefined || value === "" ? null : Number.isInteger(Number(value)) ? Number(value) : null);

/**
 * What the history says about one quote: its rows are the quote id itself and, for Reg SHO
 * threshold stocks, "{id}.SU" (the single-use pool) beside the base (pre-borrow) row.
 * { state: "offered", pricePerShare, locateType } with the cheapest offer,
 * { state: "none" } once every row ended without one, or { state: "waiting" }.
 */
export function readOffer(rows, quoteReqID) {
  const mine = rows.filter((row) => {
    const id = String(row.quoteReqID ?? "");
    return id === quoteReqID || id.startsWith(`${quoteReqID}.`);
  });
  const offers = mine
    .filter((row) => int(row.locateStatus) === OFFERED)
    .map((row) => ({ price: Number(row.locatePrice), type: TYPE_NAMES[int(row.locateType)] ?? "Locate" }))
    .filter((offer) => Number.isFinite(offer.price) && offer.price > 0)
    .sort((a, b) => a.price - b.price);
  if (offers.length) return { state: "offered", pricePerShare: offers[0].price, locateType: offers[0].type };
  if (mine.length && mine.every((row) => ENDED_WITHOUT_OFFER.has(int(row.locateStatus)))) return { state: "none" };
  return { state: "waiting" };
}

/**
 * One borrow check, as the facts route takes it: easy to borrow; else a quote for 100 shares and the
 * history read every 1.5 s until it is offered (the cheapest row) or ended without an offer. The
 * offer is left to lapse. Anything that goes wrong, or no answer within 20 s, is an error.
 */
export async function checkBorrow(client, ticker, { now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), waitMs = OFFER_WAIT_MS, pollMs = POLL_MS } = {}) {
  const result = (status, etb, pricePerShare = null, locateType = null, reason) => ({
    kind: "borrow",
    ticker,
    status,
    etb,
    pricePerShare,
    locateType,
    ...(reason ? { reason } : {}),
  });
  let etb = null;
  try {
    etb = await client.isEasyToBorrow(ticker);
    if (etb) return result("etb", true);
    const quoteReqID = await client.requestQuote(ticker);
    const deadline = now() + waitMs;
    for (;;) {
      await sleep(pollMs);
      const offer = readOffer(await client.locateHistory(), quoteReqID);
      if (offer.state === "offered") {
        // A price over $1,000 a share isn't believable; the route would refuse it anyway.
        if (offer.pricePerShare > 1000) return result("error", false, null, null, "price out of range");
        return result("offered", false, Math.round(offer.pricePerShare * 1e6) / 1e6, offer.locateType);
      }
      if (offer.state === "none") return result("none", false);
      if (now() >= deadline) return result("error", false, null, null, "no answer in time");
    }
  } catch (error) {
    return result("error", etb, null, null, error instanceof TradeZeroError ? error.message : "check failed");
  }
}
