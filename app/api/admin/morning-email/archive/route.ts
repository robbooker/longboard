import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function adminSupabase() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

type ArchiveSummary = {
  id: string;
  sent_date: string;
  subject: string;
  generated_by_email: string | null;
  created_at: string;
  top_pick_ticker: string;
  also_on_board_tickers: string[];
};

function projectTickers(stocks: unknown): { top: string; rest: string[] } {
  if (!Array.isArray(stocks)) return { top: "", rest: [] };
  const tickers = stocks.map((s) => {
    if (s && typeof s === "object" && typeof (s as { ticker?: unknown }).ticker === "string") {
      return ((s as { ticker: string }).ticker).trim();
    }
    return "";
  });
  const top = tickers[0] ?? "";
  const rest = tickers.slice(1).filter((t) => t.length > 0);
  return { top, rest };
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const admin = adminSupabase();
    const { data, error } = await admin
      .from("morning_email_archive")
      .select("id, sent_date, subject, stocks_json, generated_by_email, created_at")
      .order("created_at", { ascending: false });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const summaries: ArchiveSummary[] = (data ?? []).map((r) => {
      const { top, rest } = projectTickers(r.stocks_json);
      return {
        id: r.id as string,
        sent_date: r.sent_date as string,
        subject: r.subject as string,
        generated_by_email: (r.generated_by_email as string | null) ?? null,
        created_at: r.created_at as string,
        top_pick_ticker: top,
        also_on_board_tickers: rest,
      };
    });
    return NextResponse.json(summaries);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
