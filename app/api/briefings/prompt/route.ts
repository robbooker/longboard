import { NextResponse } from "next/server";
import { briefingPromptResponse } from "@/lib/briefings/prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(briefingPromptResponse());
}
