import { NextRequest, NextResponse } from "next/server";
import { fetchResearchBrief } from "@/lib/research-brief";

export async function GET(request: NextRequest) {
  const ticker = request.nextUrl.searchParams.get("ticker")?.trim();

  if (!ticker) {
    return NextResponse.json(
      { error: "Missing ticker parameter" },
      { status: 400 }
    );
  }

  const brief = await fetchResearchBrief(ticker);
  return NextResponse.json(brief);
}
