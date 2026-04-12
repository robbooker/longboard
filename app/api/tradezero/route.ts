import { NextResponse } from "next/server";
import { tzProxyFetch, tzAccountId } from "@/lib/tradezero-api";
import { requireAuth } from "@/lib/auth-guard";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const id = tzAccountId();
    const [account, positions] = await Promise.all([
      tzProxyFetch<Record<string, unknown>>(`/account/${id}`),
      tzProxyFetch<unknown>(`/accounts/${id}/positions`),
    ]);

    return NextResponse.json({
      account,
      positions: Array.isArray(positions) ? positions : [],
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("TradeZero API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
