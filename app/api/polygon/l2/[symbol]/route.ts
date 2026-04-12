import { NextRequest, NextResponse } from "next/server";
import { polygonFetch } from "@/lib/polygon-api";
import { requireAuth } from "@/lib/auth-guard";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const { symbol } = await params;
    const data = await polygonFetch(`/v3/quotes/${encodeURIComponent(symbol)}?limit=10`);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Polygon L2 error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
