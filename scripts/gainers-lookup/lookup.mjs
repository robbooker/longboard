#!/usr/bin/env node
// #371 Gainers Table lookup. Runs on Rob's computer as a systemd user service (see README.md).
//
// Every ~20 seconds it asks the chat which of today's gainers still need facts
// (GET /api/chat/gainers/facts), then, one at a time, shows that company's DilutionTracker page in
// the ONE DilutionTracker tab of the dedicated Chromium Rob keeps open and signed in (Chrome DevTools
// Protocol at http://127.0.0.1:9333; dt-tab.mjs), reads the country, cash left and institutional
// ownership and posts the result (POST /api/chat/gainers/facts). #472: the tab stays open and is reused
// for every stock; this program never opens a tab per stock, never closes one, and never starts or
// closes the browser. If the browser isn't answering it logs that once and checks every 2 minutes.
//
// #472: no catching up. The tickers already on today's list when the program starts count as done
// and are never looked up; only tickers that show up after it started are, once each per day. A failed
// lookup is tried again after 5, 10 and 20 minutes, then left until tomorrow.
//
// Limits: one page at a time, at least 3 seconds between pages, at most 60 pages an hour, never the
// same ticker twice within 5 minutes. It only ever opens dilutiontracker.com/app/search/<TICKER>
// and clicks nothing but that page's own News tab (#387), so it can't sign Rob out. Node 22+, no packages. The token is never printed.
//
// #373: beside that, a second loop checks what it costs to borrow each of today's gainers at
// TradeZero (tradezero.mjs: easy to borrow, else a quote for 100 shares whose offer is read and left
// to lapse) and posts it to the same route. The chat lists the tickers with no answer yet today; this
// program only checks between 4 AM and 8 PM New York time on weekdays, one at a time. Without
// TradeZero credentials it says so once and carries on with DilutionTracker.
// #480: TradeZero answers only about 100 quotes a day per key. Each ticker is checked ONCE per Eastern
// day, whatever the answer (a price, ETB, none or an error), and never again that day, retries
// included. Once a quote comes back 429 (TradeZero's daily limit) nothing more is asked of TradeZero
// that day and every ticker not checked yet is posted as "limit" ("TZ daily limit reached" in the
// table). Both are kept in BORROW_STATE_FILE, written before each quote goes out, so a restart never
// asks again; a new Eastern day starts empty.
//
// #376: a third loop, every 5 minutes between 4 AM and 8 PM New York time on weekdays, checks
// Interactive Brokers' public short stock file (ib.mjs: usa.txt.md5 first, usa.txt only when it
// changed) and posts IB's fee and shares available for today's tickers (kind "ib"). A ticker is
// sent again only when IB writes a newer file.
//
// #387: each of today's tickers also gets its DilutionTracker News tab read ONCE per Eastern day,
// when it first shows up in the Gainers Table (Rob: "check DT once for a press release when it hits
// the gainers channel, and then not again afterward until the next day"). The chat lists the tickers
// not read yet today under `news`; the read rides on the same page load as the facts when both are
// due, clicks only the page's own News tab, keeps the last 30 days of releases and posts them with
// kind "news". A failed read is tried again after 5, 10 and 20 minutes, then left until tomorrow; once
// one works the chat marks the ticker read for the day and stops listing it.
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { BrowserDown, createDtTab } from "./dt-tab.mjs";
import { createIbReader, ibPosts, ibRowsFor, ibUnsent } from "./ib.mjs";
import { DT_NEWS_EXPRESSION, dtNewsSettled, factsPayload, newsPayload, parseDilutionTracker, parseDtNews } from "./parse.mjs";
import { checkBorrow, createTradeZeroClient } from "./tradezero.mjs";
import { readTradeZeroEnv } from "./tz-env.mjs";

const HOME = homedir();
const CHAT_URL = (process.env.GAINERS_LOOKUP_CHAT_URL || "https://chat.robbooker.com").replace(/\/$/, "");
const CDP_URL = (process.env.GAINERS_LOOKUP_CDP_URL || "http://127.0.0.1:9333").replace(/\/$/, "");
const TOKEN_FILE = process.env.GAINERS_LOOKUP_TOKEN_FILE || `${HOME}/.config/longboard/gainers-lookup/ingest.token`;
const POLL_MS = 20_000;
const QUIET_POLL_MS = 300_000; // nights and weekends: no alerts come then
export const BROWSER_WAIT_MS = 120_000; // #472: the lookup browser isn't answering: check again this often
const GAP_MS = 3_000;
const PER_HOUR = 60;
const PAGE_TIMEOUT_MS = 30_000;
const CASH_WAIT_MS = 6_000; // after the header shows, how long the Cash Position section gets
const TICKER = /^[A-Z][A-Z. ]{0,11}$/;
// #373: where the TradeZero key is read from (the first file that exists), in either naming.
const TZ_ENV_FILES = process.env.GAINERS_LOOKUP_TZ_ENV_FILE
  ? [process.env.GAINERS_LOOKUP_TZ_ENV_FILE]
  : [`${HOME}/Documents/AGENT WORK/cobra-das-bridge/.tz.env`, `${HOME}/.config/cobra-term/tradezero.env`];
const BORROW_POLL_MS = 20_000;
export const BORROW_MIN_GAP_MS = 5 * 60_000;
// #480: the tickers checked at TradeZero today, and whether the daily limit was reached (never secret).
const BORROW_STATE_FILE = process.env.GAINERS_LOOKUP_BORROW_STATE_FILE || `${HOME}/.config/longboard/gainers-lookup/borrow-day.json`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (...parts) => console.log(new Date().toISOString(), ...parts);

/** The only address this program opens. */
export function lookupUrl(ticker) {
  if (!TICKER.test(ticker)) throw new Error("bad ticker");
  return `https://dilutiontracker.com/app/search/${encodeURIComponent(ticker)}`;
}

/** At most `limit` starts in any hour, and `gap` ms between two. Times are passed in for tests. */
export function createPacer({ limit = PER_HOUR, gap = GAP_MS } = {}) {
  const starts = [];
  return {
    /** How long to wait before the next start may go (0: now). */
    wait(now) {
      while (starts.length && now - starts[0] >= 3_600_000) starts.shift();
      const last = starts[starts.length - 1];
      const forGap = last === undefined ? 0 : Math.max(0, last + gap - now);
      const forHour = starts.length >= limit ? starts[0] + 3_600_000 - now : 0;
      return Math.max(forGap, forHour);
    },
    started(now) {
      starts.push(now);
    },
  };
}

/** "2026-11-08": the Eastern day, as the chat counts it. */
export function easternDay(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
}

export const NEWS_TRIES = 4;
export const LOOKUP_TRIES = 4;
export const RETRY_FIRST_MS = 5 * 60_000;

/**
 * One job (facts, or #387's News tab read) per ticker per Eastern day. A ticker is due when the chat
 * lists it and it hasn't been done here today; a failed try waits 5, 10, 20 minutes and after `tries`
 * tries the ticker is left until the next day. #472: `skip` marks tickers done without a lookup (the
 * ones already on today's list when the program started). A new day starts everyone fresh. Times are
 * passed in for tests.
 */
export function createDaySchedule({ tries = LOOKUP_TRIES, firstRetryMs = RETRY_FIRST_MS } = {}) {
  const days = new Map(); // day -> Map(ticker -> { done, count, next })
  const of = (now) => {
    const day = easternDay(now);
    if (!days.has(day)) {
      days.clear();
      days.set(day, new Map());
    }
    return days.get(day);
  };
  return {
    ready(ticker, now) {
      const entry = of(now).get(ticker);
      return !entry || (!entry.done && entry.count < tries && now >= entry.next);
    },
    succeeded(ticker, now) {
      of(now).set(ticker, { done: true, count: 0, next: Infinity });
    },
    /** #472: done for today without a lookup. */
    skip(tickers, now) {
      const today = of(now);
      for (const ticker of tickers) today.set(ticker, { done: true, count: 0, next: Infinity });
    },
    failed(ticker, now) {
      const today = of(now);
      const count = (today.get(ticker)?.count ?? 0) + 1;
      today.set(ticker, { done: false, count, next: now + firstRetryMs * 2 ** (count - 1) });
      return count;
    },
    gaveUp(ticker, now) {
      const entry = of(now).get(ticker);
      return !!entry && !entry.done && entry.count >= tries;
    },
  };
}

/** #387: the News tab schedule: once per ticker per Eastern day (createDaySchedule). */
export const createNewsSchedule = ({ tries = NEWS_TRIES, firstRetryMs = RETRY_FIRST_MS } = {}) => createDaySchedule({ tries, firstRetryMs });

/** #387: the tickers due a News tab read now: the chat's list, each not read (or given up) here today. */
export function newsDue(list, schedule, now = Date.now()) {
  return (Array.isArray(list) ? list : [])
    .map((item) => item?.ticker)
    .filter((ticker) => typeof ticker === "string" && TICKER.test(ticker) && schedule.ready(ticker, now));
}

/** Pre-market to the close of the extended session, weekdays, New York time. */
export function marketHours(now = Date.now()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", hourCycle: "h23" })
      .formatToParts(new Date(now))
      .map((part) => [part.type, part.value]),
  );
  const hour = Number(parts.hour);
  return !["Sat", "Sun"].includes(parts.weekday) && hour >= 4 && hour < 20;
}

/** Each ticker at most once per `gap` ms (the DilutionTracker page loads), so a failed post can't cause a burst. */
export function createBorrowSchedule({ gap = BORROW_MIN_GAP_MS } = {}) {
  const last = new Map();
  return {
    ready(ticker, now) {
      const at = last.get(ticker);
      return at === undefined || now - at >= gap;
    },
    started(ticker, now) {
      last.set(ticker, now);
      for (const [key, at] of last) if (now - at > 86_400_000) last.delete(key);
    },
  };
}

/** The tickers to check now: the chat's list, in market hours, each not checked here today (#480). */
export function borrowDue(list, day, now = Date.now()) {
  if (!marketHours(now)) return [];
  return [
    ...new Set(
      (Array.isArray(list) ? list : [])
        .map((item) => item?.ticker)
        .filter((ticker) => typeof ticker === "string" && TICKER.test(ticker) && !day.checked(ticker, now)),
    ),
  ];
}

const borrowBody = (ticker, status, etb = null) => ({ kind: "borrow", ticker, status, etb, pricePerShare: null, locateType: null });

/**
 * #480: the tickers checked at TradeZero this Eastern day, kept in `file` so a restart never asks
 * again: { day, limitReachedAt, tickers: { TICKER: { result, posted } } }. A ticker is written in
 * (result null) BEFORE its check goes out; one still without a result when the program starts again
 * was cut short, so it counts as checked (an error) and isn't asked again. `posted` says whether the
 * chat saved the result (a failed post is sent again; TradeZero isn't). A new day starts empty.
 * Writes go to a temporary file renamed into place, mode 600; a failed write throws (the caller then
 * asks TradeZero nothing).
 */
export function createBorrowDay({ file = BORROW_STATE_FILE, now = Date.now } = {}) {
  const empty = (day) => ({ day, limitReachedAt: null, tickers: {} });
  const load = () => {
    const day = easternDay(now());
    let data = null;
    try {
      data = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return empty(day);
    }
    if (!data || data.day !== day || !data.tickers || typeof data.tickers !== "object" || Array.isArray(data.tickers)) return empty(day);
    const tickers = {};
    for (const [ticker, entry] of Object.entries(data.tickers)) {
      if (!TICKER.test(ticker)) continue;
      const result = entry?.result && typeof entry.result === "object" ? entry.result : null;
      // Cut short by a stop or restart: checked, never asked again.
      tickers[ticker] = result ? { result, posted: entry.posted === true } : { result: { ...borrowBody(ticker, "error"), reason: "cut short by a restart" }, posted: false };
    }
    return { day, limitReachedAt: typeof data.limitReachedAt === "string" ? data.limitReachedAt : null, tickers };
  };
  let state = load();
  const save = () => {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    renameSync(temp, file);
  };
  const today = (at = now()) => {
    const day = easternDay(at);
    if (state.day !== day) state = empty(day);
    return state;
  };
  return {
    /** How many tickers were already checked today, and when the limit was reached (null: not). */
    summary(at = now()) {
      const s = today(at);
      return { day: s.day, checked: Object.keys(s.tickers).length, limitReachedAt: s.limitReachedAt };
    },
    checked: (ticker, at = now()) => Object.hasOwn(today(at).tickers, ticker),
    limitReached: (at = now()) => !!today(at).limitReachedAt,
    /** Written to the file before the check goes out. */
    start(ticker) {
      today().tickers[ticker] = { result: null, posted: false };
      save();
    },
    finish(ticker, result) {
      const s = today();
      s.tickers[ticker] = { result, posted: false };
      if (result.status === "limit" && !s.limitReachedAt) s.limitReachedAt = new Date(now()).toISOString();
      save();
    },
    posted(ticker) {
      const entry = today().tickers[ticker];
      if (!entry) return;
      entry.posted = true;
      save();
    },
    /** Results the chat hasn't saved yet: [ticker, result]. */
    unposted: () => Object.entries(today().tickers).flatMap(([ticker, entry]) => (entry.result && !entry.posted ? [[ticker, entry.result]] : [])),
  };
}

/**
 * #480: one round of the borrow loop with the chat's `borrow` list. First, results the chat hasn't
 * saved yet are posted again (TradeZero isn't asked). Then each listed ticker not checked today: once
 * the daily limit was reached it is posted as "limit" without asking TradeZero; otherwise it is written
 * to `day` (the file) first, checked once, and its answer saved, whatever it was. A 429 on a quote
 * (checkBorrow's "limit") marks the limit reached for the rest of the day.
 */
export async function borrowRound({ list, client, day, post, say = log, check = checkBorrow, now = Date.now, isStopping = () => false }) {
  let problem = "";
  const send = async (ticker, result) => {
    const { reason, ...body } = result;
    try {
      await post(body);
      day.posted(ticker);
      say(`${ticker} borrow: ${describeBorrow({ ...body, reason })}`);
    } catch (error) {
      if (error.message !== problem) say(`${ticker} borrow: couldn't save (${error.message}); posting it again next round, TradeZero isn't asked again`);
      problem = error.message;
    }
  };
  for (const [ticker, result] of day.unposted()) {
    if (isStopping()) return;
    await send(ticker, result);
  }
  for (const ticker of borrowDue(list, day, now())) {
    if (isStopping() || !marketHours(now())) break;
    let result;
    try {
      if (day.limitReached()) {
        result = borrowBody(ticker, "limit");
        day.finish(ticker, result);
      } else {
        day.start(ticker);
        result = await check(client, ticker);
        day.finish(ticker, result);
        if (result.status === "limit")
          say(`TradeZero daily limit reached (${ticker}'s quote): no more TradeZero checks today; tickers not checked yet show "TZ daily limit reached"`);
      }
    } catch (error) {
      // The day file can't be written: nothing is asked of TradeZero until it can.
      say(`borrow: can't write today's checked list (${error.message}); not asking TradeZero until it can`);
      return;
    }
    await send(ticker, result);
  }
}

// #469: readTradeZeroEnv lives in tz-env.mjs so the Trading Desk feed can share it without loading
// the borrow client; it is re-exported here for the tests and anything else that imported it from here.
export { readTradeZeroEnv };

function tradeZeroClient() {
  for (const file of TZ_ENV_FILES) {
    let info;
    try {
      info = statSync(file);
    } catch {
      continue;
    }
    if (info.mode & 0o077) return { problem: `borrow checks off: the TradeZero file must be private (chmod 600): ${file}` };
    const config = readTradeZeroEnv(readFileSync(file, "utf8"));
    const missing = [["key id", config.keyId], ["secret", config.secret], ["account id", config.accountId]]
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missing.length) return { problem: `borrow checks off: ${file} has no TradeZero ${missing.join(", ")}` };
    try {
      return { client: createTradeZeroClient(config), file };
    } catch (error) {
      return { problem: `borrow checks off: ${error.message}` };
    }
  }
  return { problem: `borrow checks off: no TradeZero file (${TZ_ENV_FILES.join(" or ")})` };
}

function readToken() {
  let info;
  try {
    info = statSync(TOKEN_FILE);
  } catch {
    throw new Error(`The token file can't be read: ${TOKEN_FILE}`);
  }
  if (info.mode & 0o077) throw new Error(`The token file must be private (chmod 600): ${TOKEN_FILE}`);
  const token = readFileSync(TOKEN_FILE, "utf8").trim();
  if (token.length < 32) throw new Error("The token file doesn't hold a token.");
  return token;
}

async function chat(token, method, body) {
  // #466: this lookup reads the float, so it asks for tickers whose float is due too.
  const response = await fetch(`${CHAT_URL}/api/chat/gainers/facts${method === "GET" ? "?float=1" : ""}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`chat answered ${response.status} ${data?.error ?? ""}`.trim());
  return data;
}

const NEWS_WAIT_MS = 15_000; // after the News tab is shown, how long its list gets

/**
 * #472: shows the company's page in the ONE DilutionTracker tab (`tab`, from dt-tab.mjs), waits for it,
 * reads its text (when `facts`) and its News tab (when `news`). The tab is left open on that page.
 * Returns { parsed, news } where news is null when not asked, else { ok, items } (ok false: the tab
 * didn't show or its list didn't draw).
 */
export async function readPage(tab, ticker, { facts = true, news = false } = {}, timing = {}) {
  const { pollMs = 500, newsPollMs = 700, pageTimeoutMs = PAGE_TIMEOUT_MS, cashWaitMs = CASH_WAIT_MS, newsWaitMs = NEWS_WAIT_MS } = timing;
  const url = lookupUrl(ticker);
  // The tab still shows the last company until the new page replaces it: mark the old page so its
  // text is never read as this ticker's (a new document never has the mark, even for the same address).
  const mark = JSON.stringify(`${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await tab.evaluate(`window.__lbGainersLookup = ${mark}`);
  const started = Date.now();
  await tab.navigate(url, { loadTimeoutMs: pageTimeoutMs });
  const pageText = `window.__lbGainersLookup === ${mark} ? null : (document.body ? document.body.innerText : "")`;
  let foundAt = 0,
    parsed = parseDilutionTracker("");
  while (Date.now() - started < pageTimeoutMs) {
    await sleep(pollMs);
    const text = await tab.evaluate(pageText);
    if (text === null) continue; // still the last page
    parsed = parseDilutionTracker(text || "");
    if (parsed.state !== "found") continue;
    foundAt ||= Date.now();
    // The header comes first; the Cash Position section can draw a moment later (or never, for big companies).
    if (!facts || (parsed.cashSection && parsed.instOwnPct !== null) || Date.now() - foundAt >= cashWaitMs) break;
  }
  if (!news) return { parsed, news: null };
  // Not on DilutionTracker: nothing to read, and that counts as today's read.
  if (parsed.state === "not_found") return { parsed, news: { ok: true, items: [] } };
  if (parsed.state !== "found") return { parsed, news: { ok: false, items: [] } };
  // #387: show the News tab, then read it once its list has drawn and stopped growing.
  const newsStarted = Date.now();
  let shownAt = 0,
    lastCount = -1;
  while (Date.now() - newsStarted < newsWaitMs) {
    const snapshot = await tab.evaluate(DT_NEWS_EXPRESSION);
    if (snapshot?.active) shownAt ||= Date.now();
    const count = snapshot?.rows?.length ?? 0;
    if (dtNewsSettled(snapshot, shownAt ? Date.now() - shownAt : 0) && (count === 0 || count === lastCount))
      return { parsed, news: { ok: true, items: parseDtNews(snapshot.rows) } };
    lastCount = count;
    await sleep(newsPollMs);
  }
  return { parsed, news: { ok: false, items: [] } };
}

const describe = (p) =>
  p.state === "not_found"
    ? "not on DilutionTracker"
    : `country ${p.country ?? "-"}, cash ${p.cashFlowPositive ? "flow positive" : (p.cashUsd ?? "-")}, months ${p.cashMonthsLeft ?? "-"}, inst ${p.instOwnPct ?? "-"}%, float ${p.floatShares ?? "-"}`;

const describeBorrow = (b) =>
  b.status === "etb"
    ? "easy to borrow"
    : b.status === "offered"
      ? `$${b.pricePerShare}/share (${b.locateType})`
      : b.status === "none"
        ? "none offered"
        : b.status === "limit"
          ? "TZ daily limit reached (not checked)"
          : `error: ${b.reason}`;

/** #373: the borrow loop. Runs beside the DilutionTracker loop, one check at a time (#480: borrowRound). */
async function borrowLoop(token, client, isStopping) {
  const day = createBorrowDay();
  const known = day.summary();
  if (known.checked || known.limitReachedAt)
    log(`borrow: ${known.checked} tickers already checked at TradeZero today, not asked again${known.limitReachedAt ? `; TradeZero's daily limit was reached at ${known.limitReachedAt}` : ""}`);
  let lastProblem = "";
  while (!isStopping()) {
    const open = marketHours();
    if (open) {
      let list = [];
      try {
        list = (await chat(token, "GET")).borrow ?? [];
        lastProblem = "";
      } catch (error) {
        if (error.message !== lastProblem) log(`borrow: chat: ${error.message}`);
        lastProblem = error.message;
      }
      await borrowRound({ list, client, day, post: (body) => chat(token, "POST", body), isStopping });
    }
    await sleep(open ? BORROW_POLL_MS : QUIET_POLL_MS);
  }
}

const IB_POLL_MS = 5 * 60_000;

/**
 * #376: one round of the IB loop: today's tickers from the chat, IB's file if it changed, and the
 * rows not yet sent for that file. `sent` (ticker -> file time) is kept between rounds.
 */
export async function ibRound({ reader, getTickers, post, sent, log: say = log }) {
  const tickers = await getTickers();
  if (!tickers.length) return 0;
  const { parsed, changed } = await reader.check();
  if (changed) say(`IB file ${parsed.fileTime}: ${parsed.rows.size} stocks${parsed.skipped ? `, ${parsed.skipped} odd lines skipped` : ""}`);
  const rows = ibUnsent(ibRowsFor(parsed, tickers), parsed.fileTime, sent);
  let saved = 0;
  for (const body of ibPosts(parsed.fileTime, rows)) {
    await post(body);
    for (const row of body.rows) sent.set(row.ticker, parsed.fileTime);
    saved += body.rows.length;
  }
  if (sent.size > 2000) for (const [ticker, at] of sent) if (at !== parsed.fileTime) sent.delete(ticker);
  return saved;
}

/** #376: the IB loop. Runs beside the others. */
async function ibLoop(token, isStopping) {
  const reader = createIbReader();
  const sent = new Map();
  let lastProblem = "";
  while (!isStopping()) {
    if (marketHours()) {
      try {
        const saved = await ibRound({
          reader,
          sent,
          getTickers: async () => (await chat(token, "GET")).tickers ?? [],
          post: (body) => chat(token, "POST", body),
        });
        if (saved) log(`IB: sent ${saved} stocks (file ${reader.parsed?.fileTime})`);
        lastProblem = "";
      } catch (error) {
        if (error.message !== lastProblem) log(`IB: ${error.message}`);
        lastProblem = error.message;
      }
    }
    await sleep(IB_POLL_MS);
  }
}

/** The tickers in one of the chat's lists ([{ ticker }] or ["TICKER"]), odd entries dropped. */
export function tickersOf(list) {
  return (Array.isArray(list) ? list : [])
    .map((item) => (typeof item === "string" ? item : item?.ticker))
    .filter((ticker) => typeof ticker === "string" && TICKER.test(ticker));
}

/**
 * #472: the DilutionTracker side, one round per chat poll (`round(listed)` with the chat's GET answer).
 * - The first round only notes every ticker already on today's list (tickers, needs, news): those count
 *   as done for today and are never looked up. Later rounds look up only tickers that showed up since.
 * - Every page goes through the one `tab` (dt-tab.mjs). If the browser isn't answering, the round says
 *   so once (not per ticker), tries nothing and returns { browserDown: true }; the caller waits
 *   BROWSER_WAIT_MS. Tickers aren't charged a try for that.
 * - One page at a time (`pacer`), never the same ticker twice within 5 minutes, failed tries again after
 *   5, 10, 20 minutes, then left until tomorrow.
 * @param {{ tab: ReturnType<typeof createDtTab>, post: (body: Record<string, any>) => Promise<any>, say?: (...parts: any[]) => void, pacer?: ReturnType<typeof createPacer>, wait?: (ms: number) => Promise<unknown>, now?: () => number, isStopping?: () => boolean, timing?: { pollMs?: number, newsPollMs?: number, pageTimeoutMs?: number, cashWaitMs?: number, newsWaitMs?: number } }} options
 */
export function createLookup({ tab, post, say = log, pacer = createPacer(), wait = sleep, now = Date.now, isStopping = () => false, timing } = {}) {
  const facts = createDaySchedule();
  const news = createNewsSchedule();
  const pages = createBorrowSchedule({ gap: BORROW_MIN_GAP_MS }); // each ticker's page at most once per 5 minutes
  let started = false;
  let down = false;
  let lastTabProblem = "";
  const note = (schedule, ticker, what, why) => {
    const count = schedule.failed(ticker, now());
    const last = schedule.gaveUp(ticker, now());
    say(`${ticker}${what}: ${why} (try ${count}${last ? "; not tried again until tomorrow" : ""})`);
  };
  const browserDown = () => {
    if (!down) say(`${tab.downMessage}; checking again every ${BROWSER_WAIT_MS / 60_000} minutes`);
    down = true;
    return { browserDown: true, looked: 0 };
  };

  return {
    async round(listed) {
      const needs = tickersOf(listed?.needs);
      const newsList = tickersOf(listed?.news);
      if (!started) {
        const there = new Set([...tickersOf(listed?.tickers), ...needs, ...newsList]);
        facts.skip(there, now());
        news.skip(there, now());
        started = true;
        say(`${there.size} tickers already on today's list: not looked up (only tickers that show up from now on are)`);
        return { browserDown: false, looked: 0, skipped: there.size };
      }
      // One page load per ticker for whatever it needs: its facts, today's news read, or both.
      const t = now();
      const work = new Map();
      for (const ticker of needs) if (facts.ready(ticker, t) && pages.ready(ticker, t)) work.set(ticker, { facts: true, news: false });
      for (const ticker of newsList) if (news.ready(ticker, t) && pages.ready(ticker, t)) work.set(ticker, { facts: work.has(ticker), news: true });
      if (!work.size) return { browserDown: false, looked: 0 };
      try {
        await tab.ready();
      } catch (error) {
        if (error instanceof BrowserDown) return browserDown();
        if (error.message !== lastTabProblem) say(`DilutionTracker tab: ${error.message}; checking again every ${BROWSER_WAIT_MS / 60_000} minutes`);
        lastTabProblem = error.message;
        return { browserDown: true, looked: 0 };
      }
      if (down || lastTabProblem) say(`DilutionTracker browser answering again; using its one DilutionTracker tab`);
      down = false;
      lastTabProblem = "";
      let looked = 0;
      for (const [ticker, want] of work) {
        if (isStopping()) break;
        for (let ms = pacer.wait(now()); ms > 0; ms = pacer.wait(now())) await wait(ms);
        pacer.started(now());
        pages.started(ticker, now());
        looked++;
        let read;
        try {
          read = await readPage(tab, ticker, want, timing);
        } catch (error) {
          // The browser went away mid-round: not this ticker's fault, and nothing more is tried now.
          if (error instanceof BrowserDown) return { ...browserDown(), looked };
          if (want.facts) note(facts, ticker, "", `lookup failed: ${error.message}`);
          if (want.news) note(news, ticker, " news", error.message);
          continue;
        }
        if (want.facts) {
          if (read.parsed.state === "loading") {
            note(facts, ticker, "", "the page didn't load; is DilutionTracker still signed in on the lookup browser?");
          } else {
            try {
              await post(factsPayload(ticker, read.parsed));
              facts.succeeded(ticker, now());
              say(`${ticker}: ${describe(read.parsed)}`);
            } catch (error) {
              note(facts, ticker, "", `lookup failed: ${error.message}`);
            }
          }
        }
        if (want.news) {
          if (!read.news?.ok) {
            note(news, ticker, " news", read.parsed.state === "loading" ? "the page didn't load" : "the News tab didn't show its list");
            continue;
          }
          try {
            const saved = await post(newsPayload(ticker, read.news.items));
            news.succeeded(ticker, now());
            say(`${ticker} news: ${saved?.saved ?? read.news.items.length} releases from the last 30 days (read once today)`);
          } catch (error) {
            note(news, ticker, " news", `couldn't save (${error.message})`);
          }
        }
      }
      return { browserDown: false, looked };
    },
  };
}

/** How long the main loop sleeps after a round. */
export function waitAfterRound(result, open) {
  if (result?.browserDown) return BROWSER_WAIT_MS;
  return open ? POLL_MS : QUIET_POLL_MS;
}

async function main() {
  const token = readToken();
  let stopping = false;
  const tab = createDtTab({ cdpUrl: CDP_URL, log });
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => {
      stopping = true;
      log("stopping");
      tab.disconnect(); // this program's connection only; the tab and the browser stay open
      setTimeout(() => process.exit(0), 100).unref();
    });
  log(`gainers lookup started: chat ${CHAT_URL}, browser ${CDP_URL}`);
  const tz = tradeZeroClient();
  if (tz.client) {
    log(`borrow checks on (TradeZero key from ${tz.file})`);
    borrowLoop(token, tz.client, () => stopping).catch((error) => log(`borrow loop stopped: ${error.message}`));
  } else log(tz.problem);
  ibLoop(token, () => stopping).catch((error) => log(`IB loop stopped: ${error.message}`));
  let lastProblem = "";
  const lookup = createLookup({ tab, post: (body) => chat(token, "POST", body), isStopping: () => stopping });
  while (!stopping) {
    const open = marketHours();
    let result = null;
    let listed = null;
    try {
      listed = await chat(token, "GET");
      if (lastProblem) log("chat reachable again");
      lastProblem = "";
    } catch (error) {
      if (`chat: ${error.message}` !== lastProblem) log(`chat: ${error.message}`);
      lastProblem = `chat: ${error.message}`;
    }
    // Without the chat's list nothing is looked up (and the start-of-day list waits for a real answer).
    if (listed)
      result = await lookup.round(listed).catch((error) => {
        log(`lookup round failed: ${error.message}`);
        return null;
      });
    await sleep(waitAfterRound(result, open));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
