import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { knownEntitlementKeys, listMembers } from "@/lib/members/admin";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/** #384: admins only. ?q= searches by email. */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const db = createChatAdminClient();
  if (!db) return json({ error: "server_not_configured" }, 503);
  try {
    const [members, keys] = await Promise.all([
      listMembers(db, request.nextUrl.searchParams.get("q") ?? ""),
      knownEntitlementKeys(db),
    ]);
    return json({ members, keys });
  } catch {
    return json({ error: "members_unavailable" }, 503);
  }
}
