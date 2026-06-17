import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { sendBugSlackReport } from "@/lib/notifications/slackBugs";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TITLE_MAX_LEN = 240;
const DESCRIPTION_MAX_LEN = 4000;
const URL_MAX_LEN = 1000;

function cleanRequired(value: unknown, max: number) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.slice(0, max);
}

function cleanOptional(value: unknown, max: number) {
  if (typeof value !== "string") return null;
  const text = value.trim().slice(0, max);
  return text || null;
}

function publicBaseUrl(req: NextRequest) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (configured) return configured.startsWith("http") ? configured : `https://${configured}`;
  return new URL(req.url).origin;
}

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bug_report_queue")
    .select("id, title, description, page_url, status, created_at, updated_at, review_note")
    .eq("reported_by", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json({ error: "load_failed", message: error.message }, { status: 500 });
  }

  return NextResponse.json({ reports: data ?? [] });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { title?: unknown; description?: unknown; pageUrl?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const title = cleanRequired(body.title, TITLE_MAX_LEN);
  const description = cleanRequired(body.description, DESCRIPTION_MAX_LEN);
  const pageUrl = cleanOptional(body.pageUrl, URL_MAX_LEN);

  if (!title) return NextResponse.json({ error: "title_required" }, { status: 400 });
  if (!description) return NextResponse.json({ error: "description_required" }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bug_report_queue")
    .insert({
      title,
      description,
      page_url: pageUrl,
      status: "pending",
      source: "web",
      reported_by: auth.user.id,
      reported_by_email: auth.user.email,
    })
    .select("id, title, description, page_url, status, reported_by_email, created_at, updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: "insert_failed", message: error.message }, { status: 500 });
  }

  const adminUrl = `${publicBaseUrl(req)}/admin/bugs?bug=${data.id}`;
  const slack = await sendBugSlackReport({
    id: data.id,
    title: data.title,
    description: data.description,
    pageUrl: data.page_url,
    reporterEmail: data.reported_by_email,
    adminUrl,
  });

  await supabase
    .from("bug_report_queue")
    .update({
      slack_posted_at: slack.ok ? new Date().toISOString() : null,
      slack_error: slack.ok ? null : slack.error,
      updated_at: new Date().toISOString(),
    })
    .eq("id", data.id);

  return NextResponse.json({ report: data, slack }, { status: 201 });
}
