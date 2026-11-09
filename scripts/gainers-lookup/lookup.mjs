#!/usr/bin/env node
// #371 Gainers Table lookup. Runs on Rob's computer as a systemd user service (see README.md).
//
// Every ~20 seconds it asks the chat which of today's gainers still need facts
// (GET /api/chat/gainers/facts), then, one at a time, opens that company's DilutionTracker page in
// the dedicated Chromium Rob keeps signed in (Chrome DevTools Protocol at http://127.0.0.1:9333),
// reads the country, cash left and institutional ownership, closes the tab and posts the result
// (POST /api/chat/gainers/facts). Each ticker is looked up once; the chat decides when cash is stale.
//
// Limits: one page at a time, at least 3 seconds between pages, at most 60 pages an hour, and a
// ticker that fails waits longer each time. It only ever opens dilutiontracker.com/app/search/<TICKER>
// and clicks nothing but that page's own News tab (#387), so it can't sign Rob out. Node 22+, no packages. The token is never printed.
//
// #373: beside that, a second loop checks what it costs to borrow each of today's gainers at
// TradeZero (tradezero.mjs: easy to borrow, else a quote for 100 shares whose offer is read and left
// to lapse) and posts it to the same route. The chat lists the tickers due a check (the first time a
// ticker shows up, then every 15 minutes while it still alerts); this program only checks between
// 4 AM and 8 PM New York time on weekdays, never the same ticker twice within 5 minutes, one at a
// time. Without TradeZero credentials it says so once and carries on with DilutionTracker.
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
// kind "news". A failed read is tried again after 2, 4 and 8 minutes, then left until tomorrow; once
// one works the chat marks the ticker read for the day and stops listing it.
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { createIbReader, ibPosts, ibRowsFor, ibUnsent } from "./ib.mjs";
import { DT_NEWS_EXPRESSION, dtNewsSettled, factsPayload, newsPayload, parseDilutionTracker, parseDtNews } from "./parse.mjs";
import { checkBorrow, createTradeZeroClient } from "./tradezero.mjs";

const HOME = homedir();
const CHAT_URL = (process.env.GAINERS_LOOKUP_CHAT_URL || "https://chat.robbooker.com").replace(/\/$/, "");
const CDP_URL = (process.env.GAINERS_LOOKUP_CDP_URL || "http://127.0.0.1:9333").replace(/\/$/, "");
const TOKEN_FILE = process.env.GAINERS_LOOKUP_TOKEN_FILE || `${HOME}/.config/longboard/gainers-lookup/ingest.token`;
const POLL_MS = 20_000;
const QUIET_POLL_MS = 300_000; // nights and weekends: no alerts come then
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

/** A ticker that failed waits 2, 4, 8 ... minutes (at most an hour) before it is tried again. */
export function createBackoff() {
  const failures = new Map();
  return {
    ready(ticker, now) {
      const entry = failures.get(ticker);
      return !entry || now >= entry.next;
    },
    failed(ticker, now) {
      const count = (failures.get(ticker)?.count ?? 0) + 1;
      failures.set(ticker, { count, next: now + Math.min(3_600_000, 60_000 * 2 ** count) });
      return count;
    },
    succeeded(ticker) {
      failures.delete(ticker);
    },
  };
}

/** "2026-11-08": the Eastern day, as the chat counts it. */
export function easternDay(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
}

export const NEWS_TRIES = 4;

/**
 * #387: one News tab read per ticker per Eastern day. A ticker is due when the chat lists it and it
 * hasn't been read here today; a failed read waits 2, 4, 8 minutes and after NEWS_TRIES tries the
 * ticker is left until the next day. A new day starts everyone fresh. Times are passed in for tests.
 */
export function createNewsSchedule({ tries = NEWS_TRIES } = {}) {
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
    failed(ticker, now) {
      const today = of(now);
      const count = (today.get(ticker)?.count ?? 0) + 1;
      today.set(ticker, { done: false, count, next: now + 60_000 * 2 ** count });
      return count;
    },
    gaveUp(ticker, now) {
      const entry = of(now).get(ticker);
      return !!entry && !entry.done && entry.count >= tries;
    },
  };
}

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

/** Each ticker at most once per `gap` ms, remembered here so a failed post can't cause a burst. */
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

/** The tickers to check now: the chat's list, in market hours, each not checked here lately. */
export function borrowDue(list, schedule, now = Date.now()) {
  if (!marketHours(now)) return [];
  return (Array.isArray(list) ? list : [])
    .map((item) => item?.ticker)
    .filter((ticker) => typeof ticker === "string" && TICKER.test(ticker) && schedule.ready(ticker, now));
}

/** TradeZero's key, secret and account from an env file's text, in either naming. Never printed. */
export function readTradeZeroEnv(text) {
  const env = {};
  for (const raw of String(text).split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const at = line.indexOf("=");
    env[line.slice(0, at).trim().replace(/^export\s+/, "")] = line.slice(at + 1).trim().replace(/^["']|["']$/g, "");
  }
  const pick = (...names) => names.map((name) => env[name]).find((value) => value) || "";
  return {
    keyId: pick("TRADEZERO_API_KEY_ID", "TZ_API_KEY_ID"),
    secret: pick("TRADEZERO_API_SECRET_KEY", "TZ_API_SECRET_KEY", "TZ_API_SECRET"),
    accountId: pick("TRADEZERO_ACCOUNT_ID", "TZ_ACCOUNT_ID"),
    baseUrl: pick("TRADEZERO_API_BASE_URL", "TZ_API_BASE_URL") || undefined,
  };
}

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
  const response = await fetch(`${CHAT_URL}/api/chat/gainers/facts`, {
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
 * Opens one tab, waits for the company's page, reads its text (when `facts`) and its News tab (when
 * `news`), and always closes the tab. Returns { parsed, news } where news is null when not asked,
 * else { ok, items } (ok false: the tab didn't show or its list didn't draw).
 */
export async function readPage(ticker, { facts = true, news = false } = {}) {
  const url = lookupUrl(ticker);
  const tab = await (await fetch(`${CDP_URL}/json/new?about:blank`, { method: "PUT", signal: AbortSignal.timeout(10_000) })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  try {
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", () => reject(new Error("couldn't reach the lookup browser tab")), { once: true });
    });
    let id = 0;
    const pending = new Map();
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    });
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const n = ++id;
        const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 10_000);
        pending.set(n, (message) => {
          clearTimeout(timer);
          resolve(message);
        });
        ws.send(JSON.stringify({ id: n, method, params }));
      });
    const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true })).result?.result?.value;
    await send("Page.navigate", { url });
    const started = Date.now();
    let foundAt = 0,
      parsed = parseDilutionTracker("");
    while (Date.now() - started < PAGE_TIMEOUT_MS) {
      await sleep(500);
      parsed = parseDilutionTracker((await evaluate("document.body ? document.body.innerText : ''")) || "");
      if (parsed.state !== "found") continue;
      foundAt ||= Date.now();
      // The header comes first; the Cash Position section can draw a moment later (or never, for big companies).
      if (!facts || (parsed.cashSection && parsed.instOwnPct !== null) || Date.now() - foundAt >= CASH_WAIT_MS) break;
    }
    if (!news) return { parsed, news: null };
    // Not on DilutionTracker: nothing to read, and that counts as today's read.
    if (parsed.state === "not_found") return { parsed, news: { ok: true, items: [] } };
    if (parsed.state !== "found") return { parsed, news: { ok: false, items: [] } };
    // #387: show the News tab, then read it once its list has drawn and stopped growing.
    const newsStarted = Date.now();
    let shownAt = 0,
      lastCount = -1;
    while (Date.now() - newsStarted < NEWS_WAIT_MS) {
      const snapshot = await evaluate(DT_NEWS_EXPRESSION);
      if (snapshot?.active) shownAt ||= Date.now();
      const count = snapshot?.rows?.length ?? 0;
      if (dtNewsSettled(snapshot, shownAt ? Date.now() - shownAt : 0) && (count === 0 || count === lastCount))
        return { parsed, news: { ok: true, items: parseDtNews(snapshot.rows) } };
      lastCount = count;
      await sleep(700);
    }
    return { parsed, news: { ok: false, items: [] } };
  } finally {
    try {
      ws.close();
    } catch {}
    await fetch(`${CDP_URL}/json/close/${tab.id}`, { signal: AbortSignal.timeout(10_000) }).catch(() => {});
  }
}

const describe = (p) =>
  p.state === "not_found"
    ? "not on DilutionTracker"
    : `country ${p.country ?? "-"}, cash ${p.cashFlowPositive ? "flow positive" : (p.cashUsd ?? "-")}, months ${p.cashMonthsLeft ?? "-"}, inst ${p.instOwnPct ?? "-"}%`;

const describeBorrow = (b) =>
  b.status === "etb"
    ? "easy to borrow"
    : b.status === "offered"
      ? `$${b.pricePerShare}/share (${b.locateType})`
      : b.status === "none"
        ? "none offered"
        : `error: ${b.reason}`;

/** #373: the borrow loop. Runs beside the DilutionTracker loop, one check at a time. */
async function borrowLoop(token, client, isStopping) {
  const schedule = createBorrowSchedule();
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
      for (const ticker of borrowDue(list, schedule)) {
        if (isStopping() || !marketHours()) break;
        schedule.started(ticker, Date.now());
        const { reason, ...result } = await checkBorrow(client, ticker);
        try {
          await chat(token, "POST", result);
          log(`${ticker} borrow: ${describeBorrow({ ...result, reason })}`);
        } catch (error) {
          log(`${ticker} borrow: couldn't save (${error.message})`);
        }
      }
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

async function main() {
  const token = readToken();
  const pacer = createPacer();
  const backoff = createBackoff();
  let stopping = false;
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => {
      stopping = true;
      log("stopping");
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
  const problem = (text) => {
    if (text !== lastProblem) log(text);
    lastProblem = text;
  };
  const newsSchedule = createNewsSchedule();
  const newsFailed = (ticker, why) => {
    const count = newsSchedule.failed(ticker, Date.now());
    const last = newsSchedule.gaveUp(ticker, Date.now());
    log(`${ticker} news: ${why} (try ${count}${last ? "; not tried again until tomorrow" : ""})`);
  };
  while (!stopping) {
    const open = marketHours();
    let needs = [],
      newsList = [];
    try {
      const listed = await chat(token, "GET");
      needs = listed.needs ?? [];
      newsList = listed.news ?? [];
      if (lastProblem) log("chat reachable again");
      lastProblem = "";
    } catch (error) {
      problem(`chat: ${error.message}`);
    }
    // One page load per ticker for whatever it needs: its facts, today's news read, or both.
    const work = new Map();
    for (const { ticker } of needs)
      if (typeof ticker === "string" && TICKER.test(ticker) && backoff.ready(ticker, Date.now())) work.set(ticker, { facts: true, news: false });
    for (const ticker of newsDue(newsList, newsSchedule)) work.set(ticker, { facts: work.has(ticker), news: true });
    for (const [ticker, want] of work) {
      if (stopping) break;
      for (let wait = pacer.wait(Date.now()); wait > 0; wait = pacer.wait(Date.now())) await sleep(wait);
      pacer.started(Date.now());
      let read;
      try {
        read = await readPage(ticker, want);
      } catch (error) {
        if (want.facts) log(`${ticker}: lookup failed (try ${backoff.failed(ticker, Date.now())}): ${error.message}`);
        if (want.news) newsFailed(ticker, error.message);
        continue;
      }
      if (want.facts) {
        if (read.parsed.state === "loading") {
          const count = backoff.failed(ticker, Date.now());
          log(`${ticker}: the page didn't load (try ${count}); is DilutionTracker still signed in on the lookup browser?`);
        } else {
          try {
            await chat(token, "POST", factsPayload(ticker, read.parsed));
            backoff.succeeded(ticker);
            log(`${ticker}: ${describe(read.parsed)}`);
          } catch (error) {
            log(`${ticker}: lookup failed (try ${backoff.failed(ticker, Date.now())}): ${error.message}`);
          }
        }
      }
      if (want.news) {
        if (!read.news?.ok) {
          newsFailed(ticker, read.parsed.state === "loading" ? "the page didn't load" : "the News tab didn't show its list");
          continue;
        }
        try {
          const saved = await chat(token, "POST", newsPayload(ticker, read.news.items));
          newsSchedule.succeeded(ticker, Date.now());
          log(`${ticker} news: ${saved?.saved ?? read.news.items.length} releases from the last 30 days (read once today)`);
        } catch (error) {
          newsFailed(ticker, `couldn't save (${error.message})`);
        }
      }
    }
    await sleep(open ? POLL_MS : QUIET_POLL_MS);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
