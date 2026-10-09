import { NextRequest, NextResponse } from "next/server";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { syncShortScoutMembership } from "@/lib/chatShortScoutSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Nightly refresh of the local ShortScout membership copy (A6). */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = createChatAdminClient();
  if (!admin) return NextResponse.json({ error: "server_not_configured" }, { status: 500 });
  try {
    const result = await syncShortScoutMembership(admin);
    // Searchable in Vercel logs; a run with outages is an error so it stands out.
    (result.unavailable ? console.error : console.log)("[shortscout-sync] cron", JSON.stringify(result));
    return NextResponse.json(result);
  } catch (error) {
    console.error("[shortscout-sync] cron failed", error);
    return NextResponse.json({ error: "shortscout_sync_failed" }, { status: 500 });
  }
}
