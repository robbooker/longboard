import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/auth";
import { runLocalQa } from "@/lib/morning-email/qa";
import { buildEmailHtml, chicagoDateLabel, chicagoYmd } from "@/lib/morning-email/render-email";
import type { MorningEmailDraft, QaMessage } from "@/lib/morning-email/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function adminSupabase() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

type GenerateInput = {
  subject?: string;
  stocks?: MorningEmailDraft["stocks"];
  closing1?: string;
  closing2?: string;
};

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: GenerateInput = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const stocks = Array.isArray(body.stocks) ? body.stocks : [];
  const subject = (body.subject || "Morning Brief").trim();
  const closing1 = (body.closing1 || "").trim();
  const closing2 = (body.closing2 || "").trim();

  const dateLabel = chicagoDateLabel();
  const sentDate = chicagoYmd();

  const draft: MorningEmailDraft = {
    date: sentDate,
    subject,
    stocks,
    closing1,
    closing2,
    qa: [],
  };

  const qa: QaMessage[] = runLocalQa(draft);

  let html: string;
  try {
    html = buildEmailHtml(draft, { dateLabel });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "render error";
    return NextResponse.json(
      { html: "", qa: [...qa, { level: "error", message: `Render failed: ${msg}` }], draftId: null },
      { status: 500 },
    );
  }

  let draftId: string | null = null;
  if (process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    try {
      const admin = adminSupabase();
      const { data, error } = await admin
        .from("morning_email_archive")
        .insert({
          sent_date: sentDate,
          subject,
          stocks_json: stocks,
          qa_json: qa,
          html,
          generated_by: auth.user.id,
          generated_by_email: auth.user.email,
        })
        .select("id")
        .single();
      if (error) {
        qa.push({ level: "warning", message: `Archive write failed: ${error.message}. HTML returned anyway.` });
      } else if (data?.id) {
        draftId = data.id as string;
        qa.push({ level: "ok", message: `Archived as ${data.id}.` });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      qa.push({ level: "warning", message: `Archive write threw: ${msg}. HTML returned anyway.` });
    }
  } else {
    qa.push({ level: "warning", message: "SUPABASE_SERVICE_ROLE_KEY missing — skipped archive write." });
  }

  return NextResponse.json({ html, qa, draftId });
}
