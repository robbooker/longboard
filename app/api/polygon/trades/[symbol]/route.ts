import { NextRequest, NextResponse } from "next/server";
import { polygonFetch } from "@/lib/polygon-api";
import { requireUser } from "@/lib/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { symbol } = await params;
    const data = await polygonFetch(`/v3/trades/${encodeURIComponent(symbol)}?limit=50`);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Polygon trades error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
