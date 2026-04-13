import { NextRequest, NextResponse } from "next/server";
import { tzProxyFetch, tzAccountId } from "@/lib/tradezero-api";
import { requireAuth } from "@/lib/auth-guard";
import { isOrderSubmissionEnabled } from "@/lib/killSwitch";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const locates = await tzProxyFetch(`/accounts/${tzAccountId()}/locates`);
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

  const ks = await isOrderSubmissionEnabled();
  if (!ks.enabled) {
    return NextResponse.json(
      { error: "order_submission_disabled", reason: ks.reason },
      { status: 503 }
    );
  }

  try {
    const body = await req.json();
    const locate = await tzProxyFetch(`/accounts/${tzAccountId()}/locate`, {
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
