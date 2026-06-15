import { NextRequest, NextResponse } from "next/server";
import { fetchShortSellersGainers } from "@/lib/gainers/shortSellersGainers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = request.nextUrl.searchParams.get("session") || "auto";
    const limitRaw = Number(request.nextUrl.searchParams.get("limit"));
    const data = await fetchShortSellersGainers({
      session: session === "pre" || session === "market" || session === "post" ? session : "auto",
      limit: Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : undefined,
    });
    return NextResponse.json({
      ...data,
      source: "shortsellers-slack-gainers",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load Short Sellers gainers.";
    console.error("[charts/gainers] Short Sellers gainers failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
