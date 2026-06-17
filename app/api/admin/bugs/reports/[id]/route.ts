import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOTE_MAX_LEN = 4000;
const ACTIONS = new Set(["approve", "ignore", "promote", "archive"]);

function cleanNote(value: unknown) {
  if (typeof value !== "string") return null;
  const text = value.trim().slice(0, NOTE_MAX_LEN);
  return text || null;
}

function codexNotes(report: {
  description: string;
  page_url: string | null;
  reported_by_email: string | null;
  created_at: string;
}, reviewNote: string | null) {
  const lines = [
    "Member bug report promoted from the Longboard bug inbox.",
    "",
    `Reporter: ${report.reported_by_email || "Unknown"}`,
    `Reported: ${report.created_at}`,
  ];

  if (report.page_url) lines.push(`Page: ${report.page_url}`);
  lines.push("", "Report:", report.description);
  if (reviewNote) lines.push("", "Review note:", reviewNote);
  return lines.join("\n");
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

  let body: { action?: unknown; reviewNote?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";
  if (!ACTIONS.has(action)) {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }

  const reviewNote = cleanNote(body.reviewNote);
  const supabase = await createClient();

  const { data: existing, error: existingError } = await supabase
    .from("bug_report_queue")
    .select("id, title, description, page_url, status, source, reported_by_email, slack_channel_id, slack_message_ts, slack_thread_ts, slack_user_id, slack_permalink, reviewed_by_email, reviewed_at, review_note, promoted_codex_task_id, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: "load_failed", message: existingError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = {
    reviewed_by: auth.user.id,
    reviewed_by_email: auth.user.email,
    reviewed_at: now,
    review_note: reviewNote,
    updated_at: now,
  };

  if (action === "approve") {
    updates.status = "approved";
  } else if (action === "ignore") {
    updates.status = "ignored";
  } else if (action === "archive") {
    updates.status = "archived";
  } else if (action === "promote") {
    if (existing.promoted_codex_task_id) {
      updates.status = "promoted";
    } else {
      const { data: task, error: taskError } = await supabase
        .from("codex_task_queue")
        .insert({
          list: "longboard",
          title: `Bug: ${existing.title}`,
          notes: codexNotes(existing, reviewNote),
          status: "open",
          source: "web",
          created_by: auth.user.id,
          created_by_email: auth.user.email,
        })
        .select("id")
        .single();

      if (taskError) {
        return NextResponse.json({ error: "promote_failed", message: taskError.message }, { status: 500 });
      }

      updates.status = "promoted";
      updates.promoted_codex_task_id = task.id;
    }
  }

  const { data, error } = await supabase
    .from("bug_report_queue")
    .update(updates)
    .eq("id", id)
    .select("id, title, description, page_url, status, source, reported_by_email, slack_channel_id, slack_message_ts, slack_thread_ts, slack_user_id, slack_permalink, reviewed_by_email, reviewed_at, review_note, promoted_codex_task_id, created_at, updated_at")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ report: data });
}
