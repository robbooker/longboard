import { NextRequest, NextResponse } from "next/server";
import { tzProxyFetch, tzAccountId } from "@/lib/tradezero-api";
import { requireUser } from "@/lib/auth";
import { isOrderSubmissionEnabled } from "@/lib/killSwitch";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

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
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

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
