import { NextResponse } from "next/server";
import { tzProxyFetch, tzAccountId } from "@/lib/tradezero-api";
import { requireAuth } from "@/lib/auth-guard";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const positions = await tzProxyFetch(`/accounts/${tzAccountId()}/positions`);
    return NextResponse.json(positions);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("TradeZero positions error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
