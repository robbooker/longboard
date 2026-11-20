// #469 Trading Desk feed: TradeZero's replies turned into the desk's feed shape (lib/tradeZeroFeed.ts).
//
// Only the fields the desk knows are copied (a whitelist), so the account number TradeZero echoes
// (`account`, `accountId`) never makes it in; and any text that still contains it (an id that embeds
// it, say) has it cut out. A field TradeZero leaves out becomes null and the desk shows "—".
// Pure functions, no network.

const LIMIT = 1e12;
const MAX_POSITIONS = 200;
const MAX_ORDERS = 300;

/** A number from a number or numeric string; null when missing or silly. */
export function num(value) {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) && Math.abs(n) <= LIMIT ? n : null;
}

const text = (value, max = 64) => (typeof value === "string" || typeof value === "number" ? String(value).trim().slice(0, max) : "");
const list = (body, ...keys) => {
  if (Array.isArray(body)) return body;
  for (const key of keys) if (Array.isArray(body?.[key])) return body[key];
  return [];
};
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);

/** Every string in `value` with the account number cut out (case-insensitive). */
export function stripAccount(value, accountId) {
  const id = String(accountId ?? "");
  if (!id) return value;
  const pattern = new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  const walk = (v) => {
    if (typeof v === "string") return v.replace(pattern, "");
    if (Array.isArray(v)) return v.map(walk);
    if (isObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k.replace(pattern, ""), walk(x)]));
    return v;
  };
  return walk(value);
}

/** True when the account number appears in any text (or key) of what would be sent. Numbers aren't text. */
export function mentionsAccount(snapshot, accountId) {
  const id = String(accountId ?? "").toLowerCase();
  if (!id) return false;
  const walk = (v) =>
    typeof v === "string"
      ? v.toLowerCase().includes(id)
      : Array.isArray(v)
        ? v.some(walk)
        : isObject(v)
          ? Object.entries(v).some(([k, x]) => k.toLowerCase().includes(id) || walk(x))
          : false;
  return walk(snapshot);
}

/** The configured account's record from /account/{id} or /accounts (an object, a list, or { accounts: [...] }). */
export function pickAccount(body, accountId) {
  const rows = Array.isArray(body) ? body : Array.isArray(body?.accounts) ? body.accounts : null;
  if (!rows) return isObject(body?.account) ? body.account : isObject(body) ? body : {};
  const id = String(accountId ?? "").toLowerCase();
  return rows.find((row) => [row?.account, row?.accountId].some((v) => String(v ?? "").toLowerCase() === id)) ?? {};
}

const ACCOUNT_TYPES = { paper: "Paper", live: "Live" };

export function accountFrom(raw) {
  const a = isObject(raw) ? raw : {};
  return {
    accountStatus: text(a.accountStatus, 32) || null,
    accountType: ACCOUNT_TYPES[text(a.accountType, 16).toLowerCase()] ?? null,
    availableCash: num(a.availableCash),
    buyingPower: num(a.buyingPower) ?? num(a.bp),
    equity: num(a.equity),
    leverage: num(a.leverage),
    overnightBp: num(a.overnightBp),
    totalLocateCosts: num(a.totalLocateCosts),
    sharesTraded: num(a.sharesTraded),
  };
}

/** A symbol as the desk takes it: capitals, digits and . - / or space, starting with a letter or digit. */
const symbolOf = (value) => text(value, 32).toUpperCase().replace(/[^A-Z0-9.\-/ ]/g, "").replace(/^[^A-Z0-9]+/, "").slice(0, 16).trim();

export function positionsFrom(body) {
  return list(body, "positions")
    .filter(isObject)
    .map((p) => {
      const symbol = symbolOf(p.symbol);
      const raw = num(p.shares) ?? 0;
      const side = /short/i.test(text(p.side)) || (!p.side && raw < 0) ? "Short" : "Long";
      return { positionId: text(p.positionId) || symbol, symbol, shares: Math.abs(raw), side, priceAvg: num(p.priceAvg) ?? 0 };
    })
    .filter((p) => p.symbol && p.shares > 0)
    .slice(0, MAX_POSITIONS);
}

/** /pnl's per-position rows, tied to the positions (by positionId, else by symbol). */
export function pnlFrom(body, positions) {
  const b = isObject(body) ? body : {};
  const ids = new Set(positions.map((p) => p.positionId));
  const bySymbol = new Map(positions.map((p) => [p.symbol, p.positionId]));
  const rows = list(b.pnl, "positions")
    .filter(isObject)
    .map((r) => {
      let positionId = text(r.positionId) || symbolOf(r.symbol);
      if (!ids.has(positionId) && bySymbol.has(symbolOf(r.symbol))) positionId = bySymbol.get(symbolOf(r.symbol));
      return { positionId, unrealizedPnL: num(r.unrealizedPnL) ?? num(r.unrealizedPnl) ?? 0, exposure: num(r.exposure) ?? 0, dayPnl: num(r.dayPnl) ?? num(r.dayPnL) };
    })
    .filter((r) => ids.has(r.positionId));
  return {
    accountValue: num(b.accountValue),
    exposure: num(b.exposure),
    dayPnl: num(b.dayPnl) ?? num(b.dayPnL),
    dayUnrealized: num(b.dayUnrealized),
    totalUnrealized: num(b.totalUnrealized),
    pnl: rows,
  };
}

const key = (value) => text(value, 32).toLowerCase().replace(/[^a-z+]/g, "");
const ORDER_TYPES = { market: "Market", mkt: "Market", limit: "Limit", lmt: "Limit", stop: "Stop", stopmarket: "Stop", stoplimit: "StopLimit", range: "Range" };
const TIFS = { day: "Day", "day+": "Day_Plus", dayplus: "Day_Plus", gtc: "GTC", goodtillcancel: "GTC", "gtc+": "GTC_Plus", gtcplus: "GTC_Plus" };
const SIDES = { buy: "Buy", sell: "Sell", short: "Short", sellshort: "Short", shortsell: "Short", cover: "Cover", buytocover: "Cover" };
/** Finished orders (and anything with nothing left) don't reach the desk: only working ones. */
const DONE = /^(filled|canceled|cancelled|rejected|expired|done|doneforday|replaced|stopped)$/;

export function ordersFrom(body) {
  return list(body, "orders")
    .filter(isObject)
    .map((o) => {
      const status = key(o.orderStatus);
      const leaves = Math.abs(num(o.leavesQuantity) ?? 0);
      if (DONE.test(status) || leaves <= 0) return null;
      const created = text(o.createdDate ?? o.createDate ?? o.createdAt, 40);
      return {
        clientOrderId: text(o.clientOrderId),
        symbol: symbolOf(o.symbol),
        side: SIDES[key(o.side)] ?? null,
        orderQuantity: Math.abs(num(o.orderQuantity) ?? 0),
        orderStatus: status.includes("partial") ? "PartiallyFilled" : status.includes("pending") ? "PendingNew" : "New",
        limitPrice: num(o.limitPrice),
        leavesQuantity: leaves,
        priceAvg: num(o.priceAvg) ?? 0,
        route: text(o.route, 16),
        orderType: ORDER_TYPES[key(o.orderType ?? o.type)] ?? null,
        timeInForce: TIFS[key(o.timeInForce ?? o.tif)] ?? null,
        stopPrice: num(o.stopPrice),
        rangeLowPrice: num(o.rangeLowPrice),
        rangeHighPrice: num(o.rangeHighPrice),
        createdDate: created && !Number.isNaN(Date.parse(created)) ? new Date(created).toISOString() : null,
      };
    })
    .filter((o) => o && o.symbol)
    .map((o, i) => (o.clientOrderId ? o : { ...o, clientOrderId: `${o.symbol}-${i + 1}` }))
    .slice(0, MAX_ORDERS);
}

/** Fields of /pnl a stream message may carry; read the same way as the REST reply. */
export function streamPnlFrom(message) {
  if (!isObject(message)) return null;
  const body = isObject(message.data) ? message.data : message;
  const values = {};
  for (const field of ["accountValue", "exposure", "dayPnl", "dayUnrealized", "totalUnrealized"]) {
    const v = num(body[field]);
    if (v !== null) values[field] = v;
  }
  const rows = list(body.pnl, "positions")
    .filter(isObject)
    .map((r) => ({ positionId: text(r.positionId), symbol: symbolOf(r.symbol), unrealizedPnL: num(r.unrealizedPnL) ?? num(r.unrealizedPnl), exposure: num(r.exposure), dayPnl: num(r.dayPnl) }))
    .filter((r) => r.positionId || r.symbol);
  return Object.keys(values).length || rows.length ? { values, rows } : null;
}

/** The REST P&L with a newer stream update laid over it (only for positions still open). */
export function overlayPnl(pnl, positions, stream) {
  if (!stream) return pnl;
  const bySymbol = new Map(positions.map((p) => [p.symbol, p.positionId]));
  const rows = new Map(pnl.pnl.map((r) => [r.positionId, { ...r }]));
  for (const r of stream.rows) {
    const id = positions.some((p) => p.positionId === r.positionId) ? r.positionId : bySymbol.get(r.symbol);
    if (!id) continue;
    const row = rows.get(id) ?? { positionId: id, unrealizedPnL: 0, exposure: 0, dayPnl: null };
    for (const field of ["unrealizedPnL", "exposure", "dayPnl"]) if (r[field] !== null && r[field] !== undefined) row[field] = r[field];
    rows.set(id, row);
  }
  return { ...pnl, ...stream.values, pnl: [...rows.values()] };
}

/**
 * One snapshot for the chat. `raw` is what TradeZero answered ({ account, positions, pnl, orders });
 * `heardAt` when it answered; `feed` the home computer's own state.
 */
/** @param {{ raw: any, accountId: string, heardAt: number, stream?: any, feed: any }} options */
export function buildSnapshot({ raw, accountId, heardAt, stream = null, feed }) {
  // The account record is picked by its number, and only its whitelisted fields are kept; the
  // number is cut out of everything else before ids are read, so an id that embeds it can't carry it.
  const account = accountFrom(pickAccount(raw.account, accountId));
  const clean = stripAccount({ positions: raw.positions, pnl: raw.pnl, orders: raw.orders, stream }, accountId);
  const positions = positionsFrom(clean.positions);
  const snapshot = {
    sample: false,
    account,
    positions,
    pnl: overlayPnl(pnlFrom(clean.pnl, positions), positions, clean.stream),
    orders: ordersFrom(clean.orders),
    bridge: {
      updatedAt: new Date(heardAt).toISOString(),
      source: "home computer",
      automation: "off",
      positions: {},
      activity: [],
      feed: {
        state: feed?.state === "error" ? "error" : "ok",
        stream: ["connected", "connecting"].includes(feed?.stream) ? feed.stream : "off",
        pollEveryMs: num(feed?.pollEveryMs) ?? 5_000,
        errors: (feed?.errors ?? []).map((e) => text(e, 200)).filter(Boolean).slice(0, 5),
      },
    },
  };
  return stripAccount(snapshot, accountId);
}
