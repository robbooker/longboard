import { NextRequest, NextResponse } from "next/server";
import { tzProxyFetch, tzAccountPath } from "@/lib/tradezero-api";
import { requireAuth } from "@/lib/auth-guard";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const locates = await tzProxyFetch(tzAccountPath("/accounts/locates/getall/{id}"));
    return NextResponse.json(locates);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("TradeZero locates error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const body = await req.json();
    const locate = await tzProxyFetch("/accounts/locates", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return NextResponse.json(locate);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("TradeZero locate submit error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
