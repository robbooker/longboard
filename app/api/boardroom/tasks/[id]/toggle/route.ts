import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/boardroom/tasks/[id]/toggle
 *  Flips is_done on the user's own task. RLS policy "users update own
 *  tasks" + "users read own tasks" ensures both the read and write are
 *  scoped to the authenticated user — a tampered id targeting another
 *  user's row simply returns 404 from the SELECT. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

  const supabase = await createClient();

  // Read-flip-write. Two round trips, but RLS makes both safe under
  // the user's session — no service-role escalation. Race condition
  // for double-clicks is benign (toggle twice → same end state).
  const { data: existing, error: readErr } = await supabase
    .from("boardroom_tasks")
    .select("id, is_done")
    .eq("id", id)
    .maybeSingle();

  if (readErr) {
    return NextResponse.json({ error: "read_failed", message: readErr.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { data: updated, error: writeErr } = await supabase
    .from("boardroom_tasks")
    .update({ is_done: !existing.is_done })
    .eq("id", id)
    .select("id, user_id, title, due_date, is_done, created_at")
    .single();

  if (writeErr) {
    return NextResponse.json({ error: "update_failed", message: writeErr.message }, { status: 500 });
  }
  return NextResponse.json(updated);
}
