// Strategy-scoped Alpaca helpers. Thin wrappers around Alpaca's v2 REST
// endpoints, using creds loaded from the vault via
// getAlpacaCredsForStrategy. Only the endpoints the Phase 1 morning
// routine needs: account equity (for sizing), last trade price (for
// sizing), and market-order placement. Extend as later phases need.

import { getAlpacaCredsForStrategy, type AlpacaCreds } from "@/lib/brokerKeys";

export type StrategyAlpacaError =
  | { ok: false; kind: "creds_missing"; missing: string[] }
  | { ok: false; kind: "http"; status: number; body: string }
  | { ok: false; kind: "unknown"; message: string };

export type StrategyAlpacaOk<T> = { ok: true; value: T };
export type StrategyAlpacaResult<T> = StrategyAlpacaOk<T> | StrategyAlpacaError;

export type AlpacaAccount = {
  equity: number;
  buying_power: number;
  cash: number;
  status: string;
};

export type AlpacaOrderSubmit = {
  id: string;
  client_order_id: string;
  status: string;
  submitted_at: string;
  filled_at: string | null;
  filled_avg_price: number | null;
};

async function loadCreds(strategyId: string): Promise<
  { ok: true; creds: AlpacaCreds } | StrategyAlpacaError
> {
  const res = await getAlpacaCredsForStrategy(strategyId);
  if (!res.ok) return { ok: false, kind: "creds_missing", missing: res.missing };
  return { ok: true, creds: res.creds };
}

async function alpacaFetch(
  creds: AlpacaCreds,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`${creds.baseUrl}${path}`, {
    ...init,
    headers: {
      "APCA-API-KEY-ID": creds.apiKey,
      "APCA-API-SECRET-KEY": creds.apiSecret,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
    signal: init?.signal ?? AbortSignal.timeout(15000),
  });
}

/** Ping Alpaca's /v2/account. Used by the morning routine's credential
 *  preflight (audit Addendum, Commit 4 concern but handy here too). */
export async function fetchStrategyAccount(strategyId: string): Promise<StrategyAlpacaResult<AlpacaAccount>> {
  const c = await loadCreds(strategyId);
  if (!c.ok) return c;

  try {
    const res = await alpacaFetch(c.creds, "/account");
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, kind: "http", status: res.status, body: body.slice(0, 400) };
    }
    const data = (await res.json()) as {
      equity?: string;
      buying_power?: string;
      cash?: string;
      status?: string;
    };
    return {
      ok: true,
      value: {
        equity: Number(data.equity ?? 0),
        buying_power: Number(data.buying_power ?? 0),
        cash: Number(data.cash ?? 0),
        status: data.status ?? "unknown",
      },
    };
  } catch (e) {
    return { ok: false, kind: "unknown", message: e instanceof Error ? e.message : "unknown" };
  }
}

/** Place a market order against the strategy's paper account. Day TIF —
 *  the morning routine hands its orders to the open and expects a fill
 *  within minutes; no GTC/OPG complexity needed for Phase 1. */
export async function submitStrategyMarketOrder(
  strategyId: string,
  params: {
    symbol: string;
    qty: number;
    side: "buy" | "sell" | "sell_short" | "buy_to_cover";
    client_order_id?: string;
  },
): Promise<StrategyAlpacaResult<AlpacaOrderSubmit>> {
  const c = await loadCreds(strategyId);
  if (!c.ok) return c;

  try {
    const body = {
      symbol: params.symbol,
      qty: String(params.qty),
      side: params.side === "buy" || params.side === "buy_to_cover" ? "buy" : "sell",
      type: "market",
      time_in_force: "day",
      ...(params.client_order_id ? { client_order_id: params.client_order_id } : {}),
    };

    const res = await alpacaFetch(c.creds, "/orders", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, kind: "http", status: res.status, body: text.slice(0, 400) };
    }
    const data = (await res.json()) as {
      id: string;
      client_order_id: string;
      status: string;
      submitted_at: string;
      filled_at: string | null;
      filled_avg_price: string | null;
    };
    return {
      ok: true,
      value: {
        id: data.id,
        client_order_id: data.client_order_id,
        status: data.status,
        submitted_at: data.submitted_at,
        filled_at: data.filled_at,
        filled_avg_price: data.filled_avg_price !== null ? Number(data.filled_avg_price) : null,
      },
    };
  } catch (e) {
    return { ok: false, kind: "unknown", message: e instanceof Error ? e.message : "unknown" };
  }
}
