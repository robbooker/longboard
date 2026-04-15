import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/auth";
import { alpacaFetch } from "@/lib/alpaca-api";
import { tzProxyFetch } from "@/lib/tradezero-api";
import { getAlpacaCredsForUser, getTradeZeroCredsForUser } from "@/lib/brokerKeys";
import type { AlpacaAccount } from "@/types/alpaca";
import type { TZAccount } from "@/lib/tradezero";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Broker = "alpaca" | "tradezero";
type Range = "1d" | "1w" | "1m" | "all";

type SnapshotRow = {
  snapshot_at: string;
  snapshot_date: string;
  equity: number;
  day_pl: number | null;
};

type HistoryResponse = {
  broker: Broker;
  range: Range;
  snapshots: Array<{ snapshot_at: string; equity: number; day_pl: number | null }>;
  summary: {
    open: number | null;
    current: number | null;
    change: number | null;
    change_pct: number | null;
  };
};

function adminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function parseBroker(v: string | null): Broker | null {
  return v === "alpaca" || v === "tradezero" ? v : null;
}

function parseRange(v: string | null): Range {
  return v === "1d" || v === "1w" || v === "1m" || v === "all" ? v : "1m";
}

/** Compute the `since` cutoff for a given range. Returns null for "all" to
 *  skip the filter. Ranges are calendar-day based, not trading-day. */
function sinceFor(range: Range): Date | null {
  if (range === "all") return null;
  const now = new Date();
  if (range === "1d") {
    // Start of today in ET — show intraday snapshots for the current trading
    // day plus the live broker point appended below.
    const etToday = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    return new Date(`${etToday}T00:00:00-05:00`);
  }
  const d = new Date(now);
  if (range === "1w") d.setDate(d.getDate() - 7);
  if (range === "1m") d.setDate(d.getDate() - 31);
  return d;
}

/** Fetch live current equity from the broker so the 1D chart ticks during
 *  market hours rather than jumping only at the 17:05 ET snapshot. Returns
 *  null on any failure — the chart still renders from the stored snapshots. */
async function fetchLiveEquity(userId: string, broker: Broker): Promise<number | null> {
  try {
    if (broker === "alpaca") {
      const credsResult = await getAlpacaCredsForUser(userId);
      if (!credsResult.ok) return null;
      const account = await alpacaFetch<AlpacaAccount>("/account", credsResult.creds);
      const eq = Number(account.equity);
      return Number.isFinite(eq) ? eq : null;
    }
    const credsResult = await getTradeZeroCredsForUser(userId);
    if (!credsResult.ok) return null;
    const account = await tzProxyFetch<TZAccount>(`/account/${credsResult.creds.accountId}`, credsResult.creds);
    const eq = Number(account.equity);
    return Number.isFinite(eq) ? eq : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const url = new URL(req.url);
  const broker = parseBroker(url.searchParams.get("broker"));
  if (!broker) return NextResponse.json({ error: "invalid_broker" }, { status: 400 });
  const range = parseRange(url.searchParams.get("range"));

  const admin = adminClient();
  let query = admin
    .from("equity_snapshots")
    .select("snapshot_at, snapshot_date, equity, day_pl")
    .eq("user_id", auth.user.id)
    .eq("broker", broker)
    .order("snapshot_at", { ascending: true });

  const since = sinceFor(range);
  if (since) query = query.gte("snapshot_at", since.toISOString());

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "query_failed", message: error.message }, { status: 500 });

  const rows = (data ?? []) as SnapshotRow[];
  const snapshots = rows.map((r) => ({
    snapshot_at: r.snapshot_at,
    equity: Number(r.equity),
    day_pl: r.day_pl === null ? null : Number(r.day_pl),
  }));

  // For 1D: append live equity as the trailing point. Skips if no snapshots
  // yet today and no live reading either — summary returns nulls.
  if (range === "1d") {
    const live = await fetchLiveEquity(auth.user.id, broker);
    if (live !== null) {
      snapshots.push({ snapshot_at: new Date().toISOString(), equity: live, day_pl: null });
    }
  }

  const open = snapshots.length > 0 ? snapshots[0].equity : null;
  const current = snapshots.length > 0 ? snapshots[snapshots.length - 1].equity : null;
  const change = open !== null && current !== null ? current - open : null;
  const change_pct = open !== null && current !== null && open !== 0 ? (current - open) / open : null;

  const body: HistoryResponse = {
    broker,
    range,
    snapshots,
    summary: { open, current, change, change_pct },
  };
  return NextResponse.json(body);
}
