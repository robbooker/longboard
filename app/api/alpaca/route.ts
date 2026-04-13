import { NextRequest, NextResponse } from "next/server";
import { alpacaFetch } from "@/lib/alpaca-api";
import { requireUser } from "@/lib/auth";
import type { AlpacaAccount, AlpacaPosition } from "@/types/alpaca";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

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
