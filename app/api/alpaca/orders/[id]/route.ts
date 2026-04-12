import { NextRequest, NextResponse } from "next/server";
import { alpacaFetch } from "@/lib/alpaca-api";
import { requireAuth } from "@/lib/auth-guard";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const { id } = await params;
    await alpacaFetch(`/v2/orders/${id}`, { method: "DELETE" });
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Alpaca cancel order error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
