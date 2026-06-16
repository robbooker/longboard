import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TITLE_MAX_LEN = 500;
const NOTES_MAX_LEN = 4000;
const OUTCOME_MAX_LEN = 4000;
const VALID_STATUSES = new Set(["open", "in_progress", "done", "archived"]);

function normalizeOptionalText(value: unknown, max: number) {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const text = value.trim().slice(0, max);
  return text || null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

  let body: { title?: unknown; notes?: unknown; status?: unknown; outcome?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const update: Record<string, string | null> = {
    updated_at: new Date().toISOString(),
  };

  if ("title" in body) {
    const title = normalizeOptionalText(body.title, TITLE_MAX_LEN);
    if (!title) return NextResponse.json({ error: "title_required" }, { status: 400 });
    update.title = title;
  }

  if ("notes" in body) {
    const notes = normalizeOptionalText(body.notes, NOTES_MAX_LEN);
    update.notes = notes ?? null;
  }

  if ("outcome" in body) {
    const outcome = normalizeOptionalText(body.outcome, OUTCOME_MAX_LEN);
    update.outcome = outcome ?? null;
  }

  if ("status" in body) {
    const status = typeof body.status === "string" ? body.status : "";
    if (!VALID_STATUSES.has(status)) {
      return NextResponse.json({ error: "invalid_status" }, { status: 400 });
    }
    update.status = status;
    if (status === "done" || status === "archived") {
      update.completed_at = new Date().toISOString();
      update.completed_by = auth.user.email;
    } else {
      update.completed_at = null;
      update.completed_by = null;
    }
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("codex_task_queue")
    .update(update)
    .eq("id", id)
    .select("id, list, title, notes, status, source, created_by_email, claimed_at, completed_at, completed_by, outcome, created_at, updated_at")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ task: data });
}
