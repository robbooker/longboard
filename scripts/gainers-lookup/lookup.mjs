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
// and never clicks anything, so it can't sign Rob out. Node 22+, no packages. The token is never printed.
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { factsPayload, parseDilutionTracker } from "./parse.mjs";

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

/** Opens one tab, waits for the company's page, reads its text, and always closes the tab. */
async function readPage(ticker) {
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
    await send("Page.navigate", { url });
    const started = Date.now();
    let foundAt = 0,
      parsed = parseDilutionTracker("");
    while (Date.now() - started < PAGE_TIMEOUT_MS) {
      await sleep(500);
      const reply = await send("Runtime.evaluate", {
        expression: "document.body ? document.body.innerText : ''",
        returnByValue: true,
      });
      parsed = parseDilutionTracker(reply.result?.result?.value || "");
      if (parsed.state !== "found") continue;
      foundAt ||= Date.now();
      // The header comes first; the Cash Position section can draw a moment later (or never, for big companies).
      if ((parsed.cashSection && parsed.instOwnPct !== null) || Date.now() - foundAt >= CASH_WAIT_MS) return parsed;
    }
    return parsed;
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
  let lastProblem = "";
  const problem = (text) => {
    if (text !== lastProblem) log(text);
    lastProblem = text;
  };
  while (!stopping) {
    const open = marketHours();
    let needs = [];
    try {
      needs = (await chat(token, "GET")).needs ?? [];
      if (lastProblem) log("chat reachable again");
      lastProblem = "";
    } catch (error) {
      problem(`chat: ${error.message}`);
    }
    for (const { ticker } of needs) {
      if (stopping) break;
      if (!TICKER.test(ticker) || !backoff.ready(ticker, Date.now())) continue;
      for (let wait = pacer.wait(Date.now()); wait > 0; wait = pacer.wait(Date.now())) await sleep(wait);
      pacer.started(Date.now());
      try {
        const parsed = await readPage(ticker);
        if (parsed.state === "loading") {
          const count = backoff.failed(ticker, Date.now());
          log(`${ticker}: the page didn't load (try ${count}); is DilutionTracker still signed in on the lookup browser?`);
          continue;
        }
        await chat(token, "POST", factsPayload(ticker, parsed));
        backoff.succeeded(ticker);
        log(`${ticker}: ${describe(parsed)}`);
      } catch (error) {
        const count = backoff.failed(ticker, Date.now());
        log(`${ticker}: lookup failed (try ${count}): ${error.message}`);
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
