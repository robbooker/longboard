// #534: the company facts the Gainers Table needs, from the DilutionTracker API (v2) instead of the
// company page. No I/O of its own: fetch, the clock and the key are passed in, so tests need no network.
//
// The four reads, per ticker (header `x-api-key`; the ticker in the path is letters only, 1 to 5):
//   GET /v2/company/profile/{T}                   { symbol, country: "China" | "U.S" | ..., inDtCoverage }
//                                                 400 problem "invalid-ticker": not on DilutionTracker
//   GET /v2/cash-position/{T}                     { hasEstCurrentCash, estCurrentCash, monthsCashRunway,
//                                                   quarterlyOperatingCashflow } in MILLIONS of USD;
//                                                 monthsCashRunway stops at 100 (100 = 100 or more);
//                                                 404 when DilutionTracker holds no cash data
//   GET /v2/institutional-ownership/companies/{T} { totalInstOwnPct } already a percent (64.5 = 64.5%)
//   GET /v2/float/{T}                             { float } in MILLIONS of shares; 404 when none
// A 404 on the last three is "none" (saved empty). 401/403/429/5xx, a network error or a timeout mean
// the API could not answer: the caller reads the company page in the browser tab instead.
//
// The key is never logged and never put in an error message (every message is scrubbed of it).
import { normaliseCountry } from "./parse.mjs";

export const DT_API_URL = "https://api.dilutiontracker.com";
/** The tickers the API takes; anything else ("BRK.B") is read from the page. */
export const DT_API_TICKER = /^[A-Za-z]{1,5}$/;
export const DT_API_TIMEOUT_MS = 10_000;
export const DT_API_KEY_BACKOFF_MS = 30 * 60_000; // 401/403: the key was refused
export const DT_API_BUSY_BACKOFF_MS = 3 * 60_000; // 429, 5xx, network error, timeout
export const DT_API_RUNWAY_CAP = 100;
const MAX_MONTHS = 1e6; // what the chat's facts route and table accept
const MAX_AMOUNT = 1e13;

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);

/**
 * The cash fields from a /v2/cash-position answer (null: the API has none).
 * @param {any} cash
 */
export function apiCash(cash) {
  const out = { cashUsd: null, cashMonthsLeft: null, cashFlowPositive: false, cashSection: false };
  if (!cash || cash.hasEstCurrentCash !== true) return out;
  out.cashSection = true;
  const est = num(cash.estCurrentCash);
  const quarterly = num(cash.quarterlyOperatingCashflow);
  const months = num(cash.monthsCashRunway);
  if (est !== null) {
    // A company estimated to be out of cash comes back negative: saved as 0.
    const usd = Math.max(0, Math.round(est * 1e6));
    out.cashUsd = usd <= MAX_AMOUNT ? usd : null;
  }
  out.cashFlowPositive = quarterly !== null && quarterly >= 0;
  // A company that makes cash has no months left to count (the same rule as the page parser).
  if (out.cashFlowPositive) return out;
  if (months !== null) {
    let left = Math.max(0, months);
    // The API stops at 100; the page shows the real figure: cash over the quarterly burn, in months.
    if (months >= DT_API_RUNWAY_CAP && quarterly !== null && quarterly < 0 && est !== null && est > 0)
      left = Math.round((est / -quarterly) * 3 * 10) / 10;
    out.cashMonthsLeft = Math.min(left, MAX_MONTHS);
  }
  return out;
}

/**
 * The parsed shape parse.mjs's factsPayload takes, from the four answers (null: that read had none).
 * @param {{ profile?: any, cash?: any, inst?: any, float?: any }} answers
 */
export function apiFacts({ profile, cash = null, inst = null, float = null }) {
  const pct = num(inst?.totalInstOwnPct);
  const millions = num(float?.float);
  const shares = millions !== null ? Math.round(millions * 1e6) : null;
  return {
    state: "found",
    country: normaliseCountry(profile?.country),
    instOwnPct: pct !== null && pct >= 0 && pct <= 1000 ? pct : null,
    floatShares: shares !== null && shares > 0 && shares <= MAX_AMOUNT ? shares : null,
    ...apiCash(cash),
  };
}

const NOT_FOUND = { state: "not_found", country: null, instOwnPct: null, floatShares: null, cashUsd: null, cashMonthsLeft: null, cashFlowPositive: false, cashSection: false };

/**
 * The API client. `facts(ticker)` answers { ok: true, parsed } (found or not found: final, post it) or
 * { ok: false, reason } (the API could not answer: read the page instead). After a refused key it stops
 * asking for 30 minutes, after 429/5xx/network trouble for 3; `available(now)` says whether it may be
 * asked. Each of those is said once through `say` when it starts.
 * @param {{ key: string, fetch?: typeof globalThis.fetch, now?: () => number, say?: (line: string) => void, baseUrl?: string, timeoutMs?: number }} options
 */
export function createDtApi({ key, fetch: fetchImpl = globalThis.fetch, now = Date.now, say = () => {}, baseUrl = DT_API_URL, timeoutMs = DT_API_TIMEOUT_MS }) {
  if (typeof key !== "string" || !key) throw new Error("no DilutionTracker API key");
  const base = baseUrl.replace(/\/$/, "");
  const scrub = (text) => String(text ?? "").split(key).join("[key]");
  let pausedUntil = 0;

  class CouldNotAnswer extends Error {
    constructor(message, backoffMs = 0) {
      super(message);
      this.backoffMs = backoffMs;
    }
  }

  /** One read: { status, body } for 200/400/404, else throws CouldNotAnswer. */
  const get = async (path) => {
    let response;
    try {
      response = await fetchImpl(`${base}${path}`, { headers: { "x-api-key": key, accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      const why = error?.name === "TimeoutError" || error?.name === "AbortError" ? "timed out" : `network error (${scrub(error?.message)})`;
      throw new CouldNotAnswer(why, DT_API_BUSY_BACKOFF_MS);
    }
    const status = response.status;
    if (status === 401 || status === 403) throw new CouldNotAnswer(`refused the key (${status})`, DT_API_KEY_BACKOFF_MS);
    if (status === 429) throw new CouldNotAnswer("rate limit reached (429)", DT_API_BUSY_BACKOFF_MS);
    if (status >= 500) throw new CouldNotAnswer(`answered ${status}`, DT_API_BUSY_BACKOFF_MS);
    if (status !== 200 && status !== 400 && status !== 404) throw new CouldNotAnswer(`answered ${status}`);
    const body = await response.json().catch(() => null);
    if (status === 200 && (!body || typeof body !== "object" || Array.isArray(body))) throw new CouldNotAnswer("answered with no data", DT_API_BUSY_BACKOFF_MS);
    return { status, body };
  };
  /** A read where 404 means "none": the body, or null. */
  const optional = async (path) => {
    const { status, body } = await get(path);
    if (status === 200) return body;
    if (status === 404) return null;
    throw new CouldNotAnswer(`answered ${status}`);
  };

  return {
    fits: (ticker) => typeof ticker === "string" && DT_API_TICKER.test(ticker),
    available: (at = now()) => at >= pausedUntil,
    async facts(ticker) {
      if (!DT_API_TICKER.test(ticker)) return { ok: false, reason: "not a ticker the API takes" };
      const t = ticker.toUpperCase();
      try {
        const profile = await get(`/v2/company/profile/${t}`);
        if (profile.status === 400 && /invalid[-\s]ticker/i.test(`${profile.body?.type ?? ""} ${profile.body?.title ?? ""}`))
          return { ok: true, parsed: { ...NOT_FOUND } };
        if (profile.status !== 200) throw new CouldNotAnswer(`answered ${profile.status} for the company`);
        const [cash, inst, float] = await Promise.all([
          optional(`/v2/cash-position/${t}`),
          optional(`/v2/institutional-ownership/companies/${t}`),
          optional(`/v2/float/${t}`),
        ]);
        return { ok: true, parsed: apiFacts({ profile: profile.body, cash, inst, float }) };
      } catch (error) {
        if (!(error instanceof CouldNotAnswer)) return { ok: false, reason: scrub(error?.message) };
        if (error.backoffMs) {
          const until = now() + error.backoffMs;
          if (now() >= pausedUntil) say(`DilutionTracker API ${error.message}; using the browser tab for facts for ${Math.round(error.backoffMs / 60_000)} minutes`);
          pausedUntil = Math.max(pausedUntil, until);
        }
        return { ok: false, reason: `the API ${error.message}` };
      }
    },
  };
}
