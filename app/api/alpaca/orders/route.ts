import { NextRequest, NextResponse } from "next/server";
import { alpacaFetch } from "@/lib/alpaca-api";
import { requireAuth } from "@/lib/auth-guard";
import { isOrderSubmissionEnabled } from "@/lib/killSwitch";
import type { AlpacaOrder } from "@/types/alpaca";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const orders = await alpacaFetch<AlpacaOrder[]>("/orders?status=open");
    return NextResponse.json(orders);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Alpaca orders error:", message);
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
    const order = await alpacaFetch<AlpacaOrder>("/orders", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return NextResponse.json(order);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Alpaca order submit error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
