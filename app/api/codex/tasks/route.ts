import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TITLE_MAX_LEN = 500;
const NOTES_MAX_LEN = 4000;
const VALID_LISTS = new Set(["longboard"]);
const VALID_STATUSES = new Set(["open", "in_progress", "done", "archived"]);

function normalizeText(value: unknown, max: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const list = url.searchParams.get("list") || "longboard";

  if (!VALID_LISTS.has(list)) {
    return NextResponse.json({ error: "invalid_list" }, { status: 400 });
  }
  if (status && status !== "all" && !VALID_STATUSES.has(status)) {
    return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  }

  const supabase = await createClient();
  let query = supabase
    .from("codex_task_queue")
    .select("id, list, title, notes, status, source, created_by_email, claimed_at, completed_at, completed_by, outcome, created_at, updated_at")
    .eq("list", list)
    .order("created_at", { ascending: true })
    .limit(200);

  if (status && status !== "all") {
    query = query.eq("status", status);
  } else if (!status) {
    query = query.in("status", ["open", "in_progress"]);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: "load_failed", message: error.message }, { status: 500 });
  }

  return NextResponse.json({ tasks: data ?? [] });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { title?: unknown; notes?: unknown; list?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const title = normalizeText(body.title, TITLE_MAX_LEN);
  const notes = normalizeText(body.notes, NOTES_MAX_LEN);
  const list = typeof body.list === "string" && body.list.trim() ? body.list.trim() : "longboard";

  if (!VALID_LISTS.has(list)) {
    return NextResponse.json({ error: "invalid_list" }, { status: 400 });
  }
  if (!title) {
    return NextResponse.json({ error: "title_required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("codex_task_queue")
    .insert({
      list,
      title,
      notes: notes || null,
      status: "open",
      source: "web",
      created_by: auth.user.id,
      created_by_email: auth.user.email,
    })
    .select("id, list, title, notes, status, source, created_by_email, claimed_at, completed_at, completed_by, outcome, created_at, updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: "insert_failed", message: error.message }, { status: 500 });
  }

  return NextResponse.json({ task: data }, { status: 201 });
}
