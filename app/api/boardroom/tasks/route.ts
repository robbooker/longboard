import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TITLE_MAX_LEN = 280;

/** POST /api/boardroom/tasks
 *  Body: { title, due_date? }
 *  Creates a personal task for the authenticated user. RLS policy
 *  "users insert own tasks" enforces user_id = auth.uid() server-side,
 *  so even a hand-crafted body can't insert into another user's list. */
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { title?: unknown; due_date?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "title_required" }, { status: 400 });
  if (title.length > TITLE_MAX_LEN) {
    return NextResponse.json({ error: "title_too_long", max: TITLE_MAX_LEN }, { status: 400 });
  }

  // YYYY-MM-DD or omit. Empty string treated as "no due date" so the
  // form can pass an empty input through transparently.
  const dueRaw = typeof body.due_date === "string" ? body.due_date.trim() : "";
  const due_date = dueRaw || null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("boardroom_tasks")
    .insert({ user_id: auth.user.id, title, due_date })
    .select("id, user_id, title, due_date, is_done, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: "insert_failed", message: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}
