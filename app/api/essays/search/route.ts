import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchRow = {
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
  rank: number;
  snippet: string;
};

/** Full-text search over essays. Calls the `search_essays` Postgres
 *  function (see supabase/migrations/20260420_essays_search_rpc.sql)
 *  which does the `plainto_tsquery` parse, ts_rank_cd ordering, and
 *  ts_headline snippet generation in a single round-trip. Admin role
 *  also searches scheduled (future `publish_at`) essays. */
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const raw = req.nextUrl.searchParams.get("q") ?? "";
  const q = raw.trim();
  if (q.length < 2) {
    return NextResponse.json(
      { error: "query_too_short", message: "q must be at least 2 characters" },
      { status: 400 },
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.rpc("search_essays", {
    q,
    include_scheduled: auth.user.role === "admin",
  });
  if (error) {
    return NextResponse.json({ error: "search_failed", message: error.message }, { status: 500 });
  }

  return NextResponse.json({ query: q, results: (data ?? []) as SearchRow[] });
}
