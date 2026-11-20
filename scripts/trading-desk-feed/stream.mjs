// #469 Trading Desk feed: TradeZero's P&L stream (wss://webapi.tradezero.com/stream/pnl), listen only.
//
// HARD RULE: the one thing this ever sends on the socket is the sign-in TradeZero asks for after it
// says PENDING_AUTH: {"key": ..., "secret": ...}, once per connection (sendAuthOnce below is the only
// send). Nothing else is ever written to it: no orders, no subscriptions, nothing.
// (TradeZero's docs also describe a subscribe message, {"account": ...}; it isn't sent. If the stream
// stays quiet without it, the feed carries on with the REST P&L it reads every few seconds anyway.)
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
 * @param {{ origin: string, keyId: string, secret: string, onPnl?: (update: any) => void, onState?: (state: string) => void, WebSocketImpl?: any }} options
 */
export function openPnlStream({ origin, keyId, secret, onPnl, onState, WebSocketImpl = globalThis.WebSocket }) {
  if (typeof WebSocketImpl !== "function") throw new Error("this Node has no WebSocket (Node 22 or newer is needed)");
  const ws = new WebSocketImpl(streamUrl(origin, "/stream/pnl"));
  let authSent = false;
  let closed = false;
  const state = (s) => {
    if (!closed) onState?.(s);
  };
  // The only send in this program's stream code.
  const sendAuthOnce = () => {
    if (authSent) return;
    authSent = true;
    ws.send(JSON.stringify({ key: keyId, secret }));
  };
  state("connecting");
  ws.addEventListener("message", (event) => {
    const raw = typeof event.data === "string" ? event.data : "";
    if (!raw || raw.length > 262_144) return;
    if (/PENDING_AUTH/i.test(raw)) return sendAuthOnce();
    if (/UNAUTHORI[SZ]ED|AUTH(ENTICATION)?[_ ]?FAIL|INVALID[_ ]?(KEY|SECRET|CREDENTIAL)/i.test(raw)) {
      state("refused");
      closed = true;
      try {
        ws.close();
      } catch {}
      return;
    }
    if (authSent && /(^|[^a-z])connected/i.test(raw)) state("connected");
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
