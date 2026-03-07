import { NextResponse } from "next/server";

const TZ_BASE = "https://webapi.tradezero.com/v1/api";

async function tzFetch<T>(path: string): Promise<T> {
  const key = process.env.TRADEZERO_API_KEY;
  const secret = process.env.TRADEZERO_API_SECRET;

  if (!key || !secret) {
    throw new Error("TradeZero API keys not configured");
  }

  const res = await fetch(`${TZ_BASE}${path}`, {
    headers: {
      "TZ-API-KEY-ID": key,
      "TZ-API-SECRET-KEY": secret,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`TradeZero ${path} returned ${res.status}: ${body}`);
  }

  return res.json();
}

export async function GET() {
  try {
    // Step 1: Get account list to discover account ID
    const accountsResp = await tzFetch<{ accounts: any[] }>("/accounts");
    const accounts = accountsResp.accounts || [];

    if (accounts.length === 0) {
      return NextResponse.json({ error: "No TradeZero accounts found" }, { status: 404 });
    }

    const acct = accounts[0]; // primary account
    const accountId = acct.account;

    // Step 2: Fetch positions
    const posResp = await tzFetch<{ positions: any[] }>(
      `/accounts/${accountId}/positions`
    );

    return NextResponse.json({
      account: acct,
      positions: posResp.positions || [],
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("TradeZero API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
