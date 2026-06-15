import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/auth";
import {
  DEFAULT_ROB_TOP_STOCKS,
  ROB_TOP_STOCKS_EDITOR_EMAIL,
  ROB_TOP_STOCKS_LIST_ID,
  normalizeRobTopStocks,
} from "@/lib/charts/robTopStocks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RobTopStocksRow = {
  symbols: string[];
  updated_at: string | null;
  updated_by_email: string | null;
};

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function isRobListEditor(email: string): boolean {
  return email.trim().toLowerCase() === ROB_TOP_STOCKS_EDITOR_EMAIL;
}

async function readRobList() {
  const supabase = serviceClient();
  if (!supabase) {
    return {
      symbols: DEFAULT_ROB_TOP_STOCKS,
      updatedAt: null,
      updatedByEmail: null,
    };
  }

  const { data, error } = await supabase
    .from("chart_shared_watchlists")
    .select("symbols, updated_at, updated_by_email")
    .eq("id", ROB_TOP_STOCKS_LIST_ID)
    .maybeSingle<RobTopStocksRow>();

  if (error) {
    console.error("[charts/rob-list] read failed", error);
    return {
      symbols: DEFAULT_ROB_TOP_STOCKS,
      updatedAt: null,
      updatedByEmail: null,
    };
  }

  return {
    symbols: normalizeRobTopStocks(data?.symbols),
    updatedAt: data?.updated_at ?? null,
    updatedByEmail: data?.updated_by_email ?? null,
  };
}

export async function GET() {
  return NextResponse.json(await readRobList());
}

export async function PUT(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!isRobListEditor(auth.user.email)) {
    return NextResponse.json({ error: "rob_list_editor_only" }, { status: 403 });
  }

  const supabase = serviceClient();
  if (!supabase) {
    return NextResponse.json({ error: "supabase_not_configured" }, { status: 500 });
  }

  const body = (await req.json().catch(() => null)) as { symbols?: unknown } | null;
  const symbols = normalizeRobTopStocks(body?.symbols);

  const { data, error } = await supabase
    .from("chart_shared_watchlists")
    .upsert({
      id: ROB_TOP_STOCKS_LIST_ID,
      label: "Rob's Top Stocks",
      symbols,
      updated_by: auth.user.id,
      updated_by_email: auth.user.email,
      updated_at: new Date().toISOString(),
    })
    .select("symbols, updated_at, updated_by_email")
    .maybeSingle<RobTopStocksRow>();

  if (error) {
    console.error("[charts/rob-list] save failed", error);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  return NextResponse.json({
    symbols: normalizeRobTopStocks(data?.symbols),
    updatedAt: data?.updated_at ?? null,
    updatedByEmail: data?.updated_by_email ?? auth.user.email,
  });
}
