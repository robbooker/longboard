import { NextRequest, NextResponse } from "next/server";
import { alpacaFetch } from "@/lib/alpaca-api";
import { requireUser } from "@/lib/auth";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { id } = await params;
    await alpacaFetch(`/orders/${id}`, { method: "DELETE" });
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Alpaca cancel order error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
