import { NextResponse } from "next/server";
import { tzProxyFetch, tzAccountPath } from "@/lib/tradezero-api";
import { requireAuth } from "@/lib/auth-guard";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const account = await tzProxyFetch(tzAccountPath("/accounts/getaccount/{id}"));
    return NextResponse.json(account);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("TradeZero account error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
