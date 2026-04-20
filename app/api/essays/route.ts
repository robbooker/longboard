import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EssayListRow = {
  slug: string;
  issue: number;
  title: string;
  kicker: string | null;
  dek: string | null;
  published: string | null;
  read_minutes: number | null;
  audio_url: string | null;
  daily_rank: number | null;
  publish_at: string | null;
  synced_at: string;
};

/** List all essays for the caller. Admins see every row (including
 *  scheduled essays with future `publish_at`); non-admin users see
 *  only published essays. Ordered by `issue` ascending so consumers
 *  that want reading-order can use the response as-is. */
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let query = admin
    .from("essays")
    .select("slug,issue,title,kicker,dek,published,read_minutes,audio_url,daily_rank,publish_at,synced_at")
    .order("issue", { ascending: true });

  if (auth.user.role !== "admin") {
    const nowIso = new Date().toISOString();
    query = query.or(`publish_at.is.null,publish_at.lte.${nowIso}`);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: "fetch_failed", message: error.message }, { status: 500 });
  }

  return NextResponse.json({ essays: (data ?? []) as EssayListRow[] });
}
