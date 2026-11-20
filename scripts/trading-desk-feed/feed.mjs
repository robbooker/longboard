#!/usr/bin/env node
// #469 Trading Desk feed. Runs on the home computer as a systemd user service (see README.md).
//
// Reads the TradeZero account READ-ONLY (account, positions, P&L, open orders) and sends the chat's
// owner-only Trading Desk the latest snapshot (POST /api/chat/trading-desk/feed). The TradeZero key
// stays on this computer: the chat only ever gets the numbers, never the key, and never the account
// number (snapshot.mjs strips it, and a snapshot that still mentions it is not sent).
//
// Read only, by construction: tz-readonly.mjs refuses anything but a GET to five addresses, and
// stream.mjs only ever sends the stream's sign-in. Nothing here can place, change or cancel an order
// or touch a locate.
//
// Pace: every 5 s from 4 AM to 8 PM New York time on weekdays (pre-market to the end of after-hours),
// every 60 s otherwise; four reads a round, at least 1 s apart. In market hours it also listens to
// TradeZero's P&L stream and lays its newer numbers over the last read. A failed round (TradeZero down,
// a 429, a refused key) waits 10 s, 20 s, 40 s ... up to 5 minutes; the chat is told in the snapshot.
// Node 22+, no packages. Nothing secret is ever printed.
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { readTradeZeroEnv } from "../gainers-lookup/tz-env.mjs";
import { buildSnapshot, mentionsAccount } from "./snapshot.mjs";
import { openPnlStream } from "./stream.mjs";
import { checkBaseUrl, createReadOnlyClient, TradeZeroError } from "./tz-readonly.mjs";

const HOME = homedir();
export const MARKET_POLL_MS = 5_000;
export const QUIET_POLL_MS = 60_000;
const MAX_BACKOFF_MS = 300_000;
const STREAM_RETRY_MS = [10_000, 30_000, 60_000, 300_000];
/** A stream update this recent stands in for the REST P&L read, which is still done every 30 s. */
export const STREAM_FRESH_MS = 10_000;
export const REST_PNL_EVERY_MS = 30_000;

/** Where the TradeZero key is read from: the first file that exists (or TRADING_DESK_TZ_ENV_FILE). */
export function keyFiles(env = process.env, home = HOME) {
  return env.TRADING_DESK_TZ_ENV_FILE
    ? [env.TRADING_DESK_TZ_ENV_FILE]
    : [
        `${home}/.config/longboard/trading-desk/tradezero.env`,
        `${home}/Documents/AGENT WORK/cobra-das-bridge/.tz.env`,
        `${home}/.config/cobra-term/tradezero.env`,
      ];
}
export const tokenFile = (env = process.env, home = HOME) => env.TRADING_DESK_TOKEN_FILE || `${home}/.config/longboard/trading-desk/feed.token`;

const log = (...parts) => console.log(new Date().toISOString(), ...parts);

/** A file only its owner can read, or null when it doesn't exist. Throws when others could read it. */
export function readPrivateFile(file) {
  let info;
  try {
    info = statSync(file);
  } catch {
    return null;
  }
  if (!info.isFile()) throw new Error(`not a file: ${file}`);
  if (info.mode & 0o077) throw new Error(`must be private (chmod 600): ${file}`);
  return readFileSync(file, "utf8");
}

/** The TradeZero key, secret and account from the first key file that exists. Never printed. */
export function loadTradeZeroKey(files = keyFiles()) {
  for (const file of files) {
    const text = readPrivateFile(file);
    if (text === null) continue;
    const config = readTradeZeroEnv(text);
    const missing = [["key id", config.keyId], ["secret", config.secret], ["account id", config.accountId]]
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missing.length) throw new Error(`${file} has no TradeZero ${missing.join(", ")}`);
    return { ...config, file };
  }
  throw new Error(`no TradeZero key file (${files.join(" or ")})`);
}

/** The chat's feed token (one line, 32+ characters). Never printed. */
export function loadToken(file = tokenFile()) {
  const text = readPrivateFile(file);
  if (text === null) throw new Error(`the token file can't be read: ${file}`);
  const token = text.trim();
  if (token.length < 32 || /\s/.test(token)) throw new Error("the token file doesn't hold a token");
  return token;
}

/** The chat's address: https, or http on this computer for testing. */
export function chatUrl(value = process.env.TRADING_DESK_CHAT_URL || "https://chat.robbooker.com") {
  const url = new URL(value);
  const local = url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !local) throw new Error("the chat address must be https");
  return url.origin;
}

/** Pre-market to the close of after-hours, weekdays, New York time. */
export function marketHours(now = Date.now()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", hourCycle: "h23" })
      .formatToParts(new Date(now))
      .map((part) => [part.type, part.value]),
  );
  const hour = Number(parts.hour);
  return !["Sat", "Sun"].includes(parts.weekday) && hour >= 4 && hour < 20;
}

/** How long to wait after a round: the pace, or after failures 10 s, 20 s, 40 s ... (5 minutes at most). */
/** @param {{ ok: boolean, failures: number, pollEveryMs: number, status?: number | null }} round */
export function nextWait({ ok, failures, pollEveryMs, status = null }) {
  if (ok) return pollEveryMs;
  const base = status === 401 || status === 403 ? MAX_BACKOFF_MS : 10_000 * 2 ** Math.max(0, failures - 1);
  return Math.min(MAX_BACKOFF_MS, Math.max(pollEveryMs, base));
}

/**
 * The feed's rounds. client: tz-readonly.mjs; post(snapshot): sends it to the chat. tick() reads
 * TradeZero once, sends a snapshot (when it has ever read one) and says how long to wait.
 */
export function createFeed({ client, post, accountId, now = Date.now, onLog = log }) {
  let raw = null;
  let heardAt = 0;
  let pnlReadAt = 0;
  let failures = 0;
  let errors = [];
  let stream = "off";
  let streamUpdate = null;
  return {
    setStream(state) {
      stream = state;
    },
    streamPnl(update) {
      streamUpdate = { ...update, at: now() };
    },
    async tick() {
      const pollEveryMs = marketHours(now()) ? MARKET_POLL_MS : QUIET_POLL_MS;
      let ok = true;
      let status = null;
      try {
        // One after another (the client spaces them), never in parallel.
        const account = await client.account();
        const positions = await client.positions();
        // With the P&L stream live, its numbers stand in for the REST P&L (one request fewer on a key the
        // borrow lookup shares); the REST P&L is still read every 30 s for the full picture.
        const streamFresh = stream === "connected" && streamUpdate && now() - streamUpdate.at < STREAM_FRESH_MS;
        let pnl = raw?.pnl;
        if (!streamFresh || !pnl || now() - pnlReadAt >= REST_PNL_EVERY_MS) {
          pnl = await client.pnl();
          pnlReadAt = now();
        }
        const orders = await client.orders();
        raw = { account, positions, pnl, orders };
        heardAt = now();
        failures = 0;
        errors = [];
      } catch (error) {
        ok = false;
        failures += 1;
        status = error?.status ?? null;
        const message = error instanceof TradeZeroError ? error.message : "reading TradeZero failed";
        errors = [failures > 1 ? `${message} (${failures} tries in a row)` : message];
        onLog(`TradeZero: ${message}`);
      }
      const wait = nextWait({ ok, failures, pollEveryMs, status });
      let posted = false;
      if (raw) {
        const snapshot = buildSnapshot({
          raw,
          accountId,
          heardAt,
          // Stream numbers newer than the REST P&L are laid over it.
          stream: streamUpdate && streamUpdate.at > pnlReadAt ? streamUpdate : null,
          feed: { state: ok ? "ok" : "error", stream, pollEveryMs, errors },
        });
        if (mentionsAccount(snapshot, accountId)) onLog("not sent: the snapshot still mentioned the account number");
        else
          try {
            await post(snapshot);
            posted = true;
          } catch (error) {
            onLog(`chat: ${error?.message ?? "send failed"}`);
          }
      }
      return { ok, posted, wait, pollEveryMs };
    },
  };
}

/** Sends one snapshot to the chat with the feed token. */
export function chatPoster(base, token, fetchImpl = globalThis.fetch) {
  return async (snapshot) => {
    const response = await fetchImpl(`${base}/api/chat/trading-desk/feed`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(snapshot),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) return;
    const data = await response.json().catch(() => null);
    if (response.status === 401) throw new Error("the chat refused the feed token (401)");
    throw new Error(`the chat answered ${response.status} ${typeof data?.error === "string" ? data.error.slice(0, 60) : ""}`.trim());
  };
}

async function main() {
  const token = loadToken();
  const key = loadTradeZeroKey();
  const origin = checkBaseUrl(process.env.TRADING_DESK_TZ_BASE_URL || key.baseUrl || undefined);
  const client = createReadOnlyClient({ ...key, baseUrl: origin });
  const feed = createFeed({ client, post: chatPoster(chatUrl(), token), accountId: key.accountId });
  const streams = process.env.TRADING_DESK_STREAM !== "0";
  log(`Trading Desk feed started: key from ${key.file}, sending to ${chatUrl()}, stream ${streams ? "on in market hours" : "off"}`);

  let stopping = false;
  let wake = () => {};
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => {
      stopping = true;
      wake();
    });

  // The P&L stream: open in market hours, closed otherwise; a dropped one is tried again later.
  let socket = null;
  let socketTries = 0;
  let socketRetryAt = 0;
  let connectedAt = 0;
  const keepStream = () => {
    const wanted = streams && !stopping && marketHours();
    if (!wanted) {
      socket?.close();
      socket = null;
      feed.setStream("off");
      return;
    }
    if (socket || Date.now() < socketRetryAt) return;
    try {
      socket = openPnlStream({
        origin,
        keyId: key.keyId,
        secret: key.secret,
        onPnl: (update) => feed.streamPnl(update),
        onState: (state) => {
          if (state === "connected") {
            connectedAt = Date.now();
            log("P&L stream connected");
          }
          feed.setStream(state === "connected" ? "connected" : state === "connecting" ? "connecting" : "off");
          if (state === "closed" || state === "refused") {
            socket = null;
            if (connectedAt && Date.now() - connectedAt > 120_000) socketTries = 0;
            connectedAt = 0;
            const wait = state === "refused" ? MAX_BACKOFF_MS : STREAM_RETRY_MS[Math.min(socketTries, STREAM_RETRY_MS.length - 1)];
            socketTries += 1;
            socketRetryAt = Date.now() + wait;
            log(`P&L stream ${state === "refused" ? "refused the key" : "closed"}; trying again in ${Math.round(wait / 1000)} s`);
          }
        },
      });
    } catch (error) {
      log(`P&L stream off: ${error.message}`);
      socketRetryAt = Date.now() + MAX_BACKOFF_MS;
    }
  };

  let lastLogged = "";
  while (!stopping) {
    keepStream();
    const round = await feed.tick();
    const line = round.ok ? (round.posted ? "sending" : "not sending") : "backing off";
    if (line !== lastLogged) log(`feed ${line}, next read in ${Math.round(round.wait / 1000)} s`);
    lastLogged = line;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, round.wait);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
  socket?.close();
  log("Trading Desk feed stopped");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
