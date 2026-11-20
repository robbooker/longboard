// #469 Trading Desk feed: TradeZero's P&L stream (wss://webapi.tradezero.com/stream/pnl), listen only.
//
// HARD RULE: this only ever sends two things on the socket, each once per connection, through the one
// write below (sendOnce): the sign-in TradeZero asks for after PENDING_AUTH, {"key": ..., "secret": ...},
// and (#471, Rob approved 2026-11-20) after CONNECTED the read-only P&L subscription TradeZero's docs
// describe, {"account": ...}. Nothing else is ever written to it: no orders, nothing.
// Everything that comes back is read as numbers only (snapshot.mjs streamPnlFrom).
import { streamPnlFrom } from "./snapshot.mjs";

const STREAM_PATHS = new Set(["/stream/pnl", "/stream/portfolio"]);

/** wss://webapi.tradezero.com/stream/pnl from the checked REST origin (ws:// for a local test server). */
export function streamUrl(origin, path = "/stream/pnl") {
  if (!STREAM_PATHS.has(path)) throw new Error("refused: not a TradeZero stream");
  const url = new URL(path, origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

/**
 * Opens the P&L stream. onPnl(update) for each message with P&L numbers in it; onState("connecting" |
 * "connected" | "closed" | "refused"). Returns { close }.
 * @param {{ origin: string, keyId: string, secret: string, accountId: string, onPnl?: (update: any) => void, onState?: (state: string) => void, WebSocketImpl?: any }} options
 */
export function openPnlStream({ origin, keyId, secret, accountId, onPnl, onState, WebSocketImpl = globalThis.WebSocket }) {
  if (typeof WebSocketImpl !== "function") throw new Error("this Node has no WebSocket (Node 22 or newer is needed)");
  if (typeof accountId !== "string" || !accountId) throw new Error("the P&L stream needs the account id");
  const ws = new WebSocketImpl(streamUrl(origin, "/stream/pnl"));
  const sent = { auth: false, subscribe: false };
  let closed = false;
  const state = (s) => {
    if (!closed) onState?.(s);
  };
  // The only write in this program's stream code: the sign-in, then the subscription, once each.
  const MESSAGES = { auth: () => ({ key: keyId, secret }), subscribe: () => ({ account: accountId }) };
  const sendOnce = (kind) => {
    if (sent[kind] || (kind === "subscribe" && !sent.auth)) return;
    sent[kind] = true;
    ws.send(JSON.stringify(MESSAGES[kind]()));
  };
  state("connecting");
  ws.addEventListener("message", (event) => {
    const raw = typeof event.data === "string" ? event.data : "";
    if (!raw || raw.length > 262_144) return;
    if (/PENDING_AUTH/i.test(raw)) return sendOnce("auth");
    if (/UNAUTHORI[SZ]ED|AUTH(ENTICATION)?[_ ]?FAIL|INVALID[_ ]?(KEY|SECRET|CREDENTIAL)/i.test(raw)) {
      state("refused");
      closed = true;
      try {
        ws.close();
      } catch {}
      return;
    }
    if (sent.auth && /(^|[^a-z])connected/i.test(raw)) {
      state("connected");
      sendOnce("subscribe");
    }
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    const update = streamPnlFrom(message);
    if (update) onPnl?.(update);
  });
  ws.addEventListener("close", () => {
    state("closed");
    closed = true;
  });
  ws.addEventListener("error", () => {
    try {
      ws.close();
    } catch {}
  });
  return {
    close() {
      state("closed");
      closed = true;
      try {
        ws.close();
      } catch {}
    },
  };
}
