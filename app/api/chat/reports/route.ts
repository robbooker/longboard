import { NextRequest, NextResponse } from "next/server";
import { requireChatOwner } from "@/lib/chatAdmin";
import { CHAT_UUID } from "@/lib/chatMembers";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(req: NextRequest) {
  const owner = await requireChatOwner(req);
  if (!owner.ok) return json({ error: owner.error }, owner.status);
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    const { data, error } = await owner.admin.from("longboard_chat_reports").select("id, reason, created_at").order("created_at", { ascending: false }).limit(50);
    return error ? json({ error: "reports_unavailable" }, 503) : json({ reports: data });
  }
  if (!CHAT_UUID.test(id)) return json({ error: "invalid_report" }, 400);
  const { data: report, error: reportError } = await owner.admin.from("longboard_chat_reports").select("id, reason, conversation_id, reporter_id, created_at").eq("id", id).maybeSingle();
  if (reportError) return json({ error: "reports_unavailable" }, 503);
  if (!report) return json({ error: "report_not_found" }, 404);
  // The owner may inspect only a conversation with a submitted report here.
  const { data, error } = await owner.admin.from("longboard_chat_direct_messages").select("id, sender_id, body, created_at").eq("conversation_id", report.conversation_id).order("seq", { ascending: false }).limit(100);
  if (error) return json({ error: "reported_messages_unavailable" }, 503);
  const ids = [...new Set([report.reporter_id, ...(data ?? []).map((m) => m.sender_id)])];
  const { data: members, error: namesError } = await owner.admin.from("longboard_chat_members").select("id, display_name").in("id", ids);
  if (namesError) return json({ error: "reported_members_unavailable" }, 503);
  return json({ report, messages: (data ?? []).reverse(), members: members ?? [] });
}
