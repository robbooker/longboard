import { NextResponse } from "next/server";
import { tzProxyFetch } from "@/lib/tradezero-api";
import { requireAuth } from "@/lib/auth-guard";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const accounts = await tzProxyFetch("/accounts");
    return NextResponse.json(accounts);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("TradeZero accounts error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
