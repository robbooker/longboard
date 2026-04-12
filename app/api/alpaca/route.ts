import { NextResponse } from "next/server";
import { alpacaFetch } from "@/lib/alpaca-api";
import { requireAuth } from "@/lib/auth-guard";
import type { AlpacaAccount, AlpacaPosition } from "@/types/alpaca";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const [account, positions] = await Promise.all([
      alpacaFetch<AlpacaAccount>("/account"),
      alpacaFetch<AlpacaPosition[]>("/positions"),
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
