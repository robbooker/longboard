import { NextResponse } from "next/server";
import { tzProxyFetch, tzAccountPath } from "@/lib/tradezero-api";
import { requireAuth } from "@/lib/auth-guard";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const routes = await tzProxyFetch(tzAccountPath("/accounts/routes/{id}"));
    return NextResponse.json(routes);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("TradeZero routes error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
