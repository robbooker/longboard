import { NextResponse } from "next/server";
import { tzProxyFetch } from "@/lib/tradezero-api";
import { requireAuth } from "@/lib/auth-guard";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const routes = await tzProxyFetch("/routes");
    return NextResponse.json(routes);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("TradeZero routes error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
