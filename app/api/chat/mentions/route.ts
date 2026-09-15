import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { findChatMember } from "@/lib/chatMembers";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const query = (req.nextUrl.searchParams.get("q") || "").normalize("NFKC");
  if (query.length > 28 || !/^[\p{L}\p{N} _.'-]*$/u.test(query)) return json({ error: "invalid_query" }, 400);
  const admin = createChatAdminClient();
  if (!admin) return json({ error: "unavailable" }, 503);
  try {
    if (!await findChatMember(admin, auth.user.id)) return json({ error: "member_required" }, 403);
    const { data, error } = await admin.from("longboard_chat_members")
      .select("id, display_name").ilike("display_name", `${query.replace(/_/g, "\\_")}%`)
      .order("display_name").limit(10);
    if (error) return json({ error: "unavailable" }, 503);
    return json({ members: data });
  } catch { return json({ error: "unavailable" }, 503); }
}
