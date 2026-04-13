import { NextRequest, NextResponse } from "next/server";
import { tzProxyFetch, tzAccountId } from "@/lib/tradezero-api";
import { requireUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const account = await tzProxyFetch(`/account/${tzAccountId()}`);
    return NextResponse.json(account);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("TradeZero account error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
