import { createClient } from "@supabase/supabase-js";
import { alpacaFetch } from "@/lib/alpaca-api";
import { tzProxyFetch } from "@/lib/tradezero-api";
import { getAlpacaCredsForUser, getTradeZeroCredsForUser } from "@/lib/brokerKeys";
import type { AlpacaAccount, AlpacaPosition } from "@/types/alpaca";
import type { TZAccount, TZPosition } from "@/lib/tradezero";

type Broker = "alpaca" | "tradezero";

export type SnapshotResult =
  | { ok: true; broker: Broker; accountId: string; equity: number; day_pl: number | null; positions_count: number }
  | { ok: false; broker: Broker; reason: string };

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Today's date in ET as YYYY-MM-DD. Matches the convention used in the
 *  research cron — snapshot_date is keyed on the trading day, not UTC. */
function todayInET(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

async function captureAlpaca(userId: string): Promise<SnapshotResult> {
  const credsResult = await getAlpacaCredsForUser(userId);
  if (!credsResult.ok) return { ok: false, broker: "alpaca", reason: `creds missing: ${credsResult.missing.join(", ")}` };
  const creds = credsResult.creds;

  const [account, positions] = await Promise.all([
    alpacaFetch<AlpacaAccount>("/account", creds),
    alpacaFetch<AlpacaPosition[]>("/positions", creds),
  ]);

  const equity = Number(account.equity);
  const lastEquity = Number(account.last_equity);
  const day_pl = Number.isFinite(equity) && Number.isFinite(lastEquity) ? equity - lastEquity : null;
  const open_pl = positions.reduce((sum, p) => sum + (Number(p.unrealized_pl) || 0), 0);

  const admin = adminClient();
  const { error } = await admin
    .from("equity_snapshots")
    .upsert(
      {
        user_id: userId,
        broker: "alpaca",
        account_id: account.account_number,
        snapshot_date: todayInET(),
        snapshot_at: new Date().toISOString(),
        equity,
        cash: Number(account.cash) || null,
        buying_power: Number(account.buying_power) || null,
        day_pl,
        open_pl,
        positions_count: positions.length,
      },
      { onConflict: "user_id,broker,snapshot_date" }
    );

  if (error) return { ok: false, broker: "alpaca", reason: `upsert failed: ${error.message}` };

  return {
    ok: true,
    broker: "alpaca",
    accountId: account.account_number,
    equity,
    day_pl,
    positions_count: positions.length,
  };
}

async function captureTradeZero(userId: string): Promise<SnapshotResult> {
  const credsResult = await getTradeZeroCredsForUser(userId);
  if (!credsResult.ok) return { ok: false, broker: "tradezero", reason: `creds missing: ${credsResult.missing.join(", ")}` };
  const creds = credsResult.creds;

  const [account, positionsResp] = await Promise.all([
    tzProxyFetch<TZAccount>(`/account/${creds.accountId}`, creds),
    // Positions endpoint wraps in { positions: [...] }. Unwrap defensively
    // — the internal /api/tradezero/positions route already does this,
    // but we're bypassing it to keep the snapshot path self-contained.
    tzProxyFetch<{ positions?: TZPosition[] } | TZPosition[]>(`/accounts/${creds.accountId}/positions`, creds),
  ]);

  const positions = Array.isArray(positionsResp)
    ? positionsResp
    : Array.isArray(positionsResp.positions)
      ? positionsResp.positions
      : [];

  const equity = Number(account.equity);
  const sodEquity = Number(account.sodEquity);
  // Full day P&L including realized + unrealized = equity - sodEquity.
  // account.realized covers closed-intraday only; equity-sodEquity is the
  // more useful "your P&L for today" number.
  const day_pl = Number.isFinite(equity) && Number.isFinite(sodEquity) ? equity - sodEquity : null;

  const admin = adminClient();
  const { error } = await admin
    .from("equity_snapshots")
    .upsert(
      {
        user_id: userId,
        broker: "tradezero",
        account_id: creds.accountId,
        snapshot_date: todayInET(),
        snapshot_at: new Date().toISOString(),
        equity,
        cash: Number(account.availableCash) || null,
        buying_power: Number(account.bp) || null,
        day_pl,
        // TZ doesn't return open_pl directly. Leaving null — computing it
        // would need a quote feed per position, out of scope for the
        // snapshot path.
        open_pl: null,
        positions_count: positions.length,
      },
      { onConflict: "user_id,broker,snapshot_date" }
    );

  if (error) return { ok: false, broker: "tradezero", reason: `upsert failed: ${error.message}` };

  return {
    ok: true,
    broker: "tradezero",
    accountId: creds.accountId,
    equity,
    day_pl,
    positions_count: positions.length,
  };
}

/** Capture a snapshot for one (user, broker) pair. Throws on unexpected
 *  errors (broker API down, etc.); returns ok:false for "configured but
 *  failed" and "not configured" cases so callers can distinguish. */
export async function captureSnapshot(userId: string, broker: Broker): Promise<SnapshotResult> {
  try {
    return broker === "alpaca" ? await captureAlpaca(userId) : await captureTradeZero(userId);
  } catch (e) {
    return { ok: false, broker, reason: e instanceof Error ? e.message : "unknown" };
  }
}

/** Returns every user_id that has any broker keys stored. Used by the
 *  cron-triggered batch path to iterate all configured users and try
 *  both brokers per user. */
export async function listConfiguredUserIds(): Promise<string[]> {
  const admin = adminClient();
  const { data, error } = await admin.from("user_broker_keys").select("user_id");
  if (error) throw new Error(`user list failed: ${error.message}`);
  const set = new Set<string>();
  for (const r of (data ?? []) as { user_id: string }[]) set.add(r.user_id);
  return Array.from(set);
}
