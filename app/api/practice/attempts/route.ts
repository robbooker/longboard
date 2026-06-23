import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PracticeAttemptBody = {
  setupKey?: string;
  accountBalance?: number;
  attemptNumber?: number;
  completedAt?: string;
  executions?: unknown;
  metrics?: unknown;
  notes?: string;
  selfScore?: string;
  reveal?: unknown;
};

function numberOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("practice_attempts")
    .select("id,setup_key,attempt_number,completed_at,metrics,created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ attempts: data ?? [] }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: PracticeAttemptBody;
  try {
    body = (await req.json()) as PracticeAttemptBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.setupKey || typeof body.setupKey !== "string") {
    return NextResponse.json({ error: "setupKey is required." }, { status: 400 });
  }

  const accountBalance = numberOrNull(body.accountBalance);
  if (accountBalance == null || accountBalance <= 0) {
    return NextResponse.json({ error: "accountBalance must be positive." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("practice_attempts")
    .insert({
      user_id: auth.user.id,
      setup_key: body.setupKey,
      account_balance: accountBalance,
      attempt_number: Math.max(1, Math.floor(numberOrNull(body.attemptNumber) ?? 1)),
      completed_at: body.completedAt ?? new Date().toISOString(),
      executions: body.executions ?? [],
      metrics: body.metrics ?? {},
      notes: typeof body.notes === "string" ? body.notes.slice(0, 5000) : null,
      self_score: typeof body.selfScore === "string" ? body.selfScore : "unscored",
      reveal: body.reveal ?? {},
    })
    .select("id,setup_key,attempt_number,completed_at,metrics,created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ attempt: data }, { status: 201 });
}
