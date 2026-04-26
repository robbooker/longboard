import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DELETE /api/boardroom/tasks/[id]
 *  Removes the user's own task. RLS policy "users delete own tasks"
 *  enforces user_id = auth.uid(), so a tampered id targeting another
 *  user's row is a no-op (no rows affected, still returns 200). */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

  const supabase = await createClient();
  const { error } = await supabase
    .from("boardroom_tasks")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: "delete_failed", message: error.message }, { status: 500 });
  }
  return NextResponse.json({ id, removed: true });
}
