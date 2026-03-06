import { NextResponse } from "next/server";
import type { AlpacaAccount, AlpacaPosition } from "@/types/alpaca";

const ALPACA_BASE = "https://paper-api.alpaca.markets";

async function alpacaFetch<T>(path: string): Promise<T> {
  const key = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_API_SECRET;

  if (!key || !secret) {
    throw new Error("Alpaca API keys not configured");
  }

  const res = await fetch(`${ALPACA_BASE}${path}`, {
    headers: {
      "APCA-API-KEY-ID": key,
      "APCA-API-SECRET-KEY": secret,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Alpaca ${path} returned ${res.status}: ${body}`);
  }

  return res.json();
}

export async function GET() {
  try {
    const [account, positions] = await Promise.all([
      alpacaFetch<AlpacaAccount>("/v2/account"),
      alpacaFetch<AlpacaPosition[]>("/v2/positions"),
    ]);

    return NextResponse.json({
      account,
      positions,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Alpaca API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
