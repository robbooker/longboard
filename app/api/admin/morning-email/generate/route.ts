import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { saveReportVersion } from "@/lib/morning-report/service";
import { runLocalQa } from "@/lib/morning-email/qa";
import { buildEmailHtml, chicagoDateLabel, chicagoYmd } from "@/lib/morning-email/render-email";
import type { MorningEmailDraft, QaMessage } from "@/lib/morning-email/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
      const generatedAt = new Date().toISOString();
      draft.qa = qa;
      draftId = await saveReportVersion({
        draft,
        html,
        versionType: "manual_full_regeneration",
        trigger: "admin",
        jobRunId: null,
        pricesUpdatedAt: generatedAt,
        generatedAt,
        actor: { id: auth.user.id, email: auth.user.email },
      });
      qa.push({ level: "ok", message: `Archived as ${draftId}.` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      qa.push({ level: "warning", message: `Archive write threw: ${msg}. HTML returned anyway.` });
    }
  } else {
    qa.push({ level: "warning", message: "SUPABASE_SERVICE_ROLE_KEY missing — skipped archive write." });
  }

  return NextResponse.json({ html, qa, draftId });
}
