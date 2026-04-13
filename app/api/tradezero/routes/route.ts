import { NextRequest, NextResponse } from "next/server";
import { tzProxyFetch } from "@/lib/tradezero-api";
import { requireUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const routes = await tzProxyFetch("/routes");
    return NextResponse.json(routes);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("TradeZero routes error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
