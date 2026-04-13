import { NextRequest, NextResponse } from "next/server";
import { alpacaFetch } from "@/lib/alpaca-api";
import { requireUser } from "@/lib/auth";
import { getAlpacaCredsForUser } from "@/lib/brokerKeys";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const credsResult = await getAlpacaCredsForUser(auth.user.id);
  if (!credsResult.ok) {
    return NextResponse.json(
      { error: "broker_not_configured", broker: "alpaca", missing: credsResult.missing },
      { status: 412 }
    );
  }

  try {
    const { id } = await params;
    await alpacaFetch(`/orders/${id}`, credsResult.creds, { method: "DELETE" });
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Alpaca cancel order error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
