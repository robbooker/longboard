import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createChatAdminClient, requestOriginAllowed } from "@/lib/chatAdmin";
import { CHAT_UUID } from "@/lib/chatMembers";
import { DM_ERRORS } from "@/lib/chatDirectMessages";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const conversationId = req.nextUrl.searchParams.get("conversation");
  if (conversationId) {
    if (!CHAT_UUID.test(conversationId)) return json({ error: "invalid_conversation" }, 400);
    // Read with the user's session: RLS independently enforces participation.
    const client = await createClient();
    const { data: conversation, error: lookupError } = await client.from("longboard_chat_conversations").select("id").eq("id", conversationId).maybeSingle();
    if (lookupError) return json({ error: "inbox_unavailable" }, 503);
    if (!conversation) return json({ error: "conversation_not_found" }, 404);
    const before = req.nextUrl.searchParams.get("before");
    if (before && !/^\d{1,16}$/.test(before)) return json({ error: "invalid_cursor" }, 400);
    let query = client.from("longboard_chat_direct_messages").select("id, seq, sender_id, body, created_at").eq("conversation_id", conversationId).order("seq", { ascending: false }).limit(51);
    if (before) query = query.lt("seq", before);
    const { data, error } = await query;
    if (error) return json({ error: "messages_unavailable" }, 503);
    return json({ messages: (data ?? []).slice(0, 50).reverse(), hasMore: (data?.length ?? 0) > 50 });
  }
  const admin = createChatAdminClient();
  if (!admin) return json({ error: "server_not_configured" }, 503);
  const { data, error } = await admin.rpc("longboard_chat_inbox", { p_user_id: auth.user.id });
  return error ? json({ error: "inbox_unavailable" }, 503) : json({ conversations: data });
}
export async function POST(req: NextRequest) {
  if (!requestOriginAllowed(req)) return json({ error: "origin_not_allowed" }, 403);
  const auth = await requireUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const payload = await req.json().catch(() => null);
  const actions = ["request", "send", "accept", "decline", "block", "unblock", "report", "read", "settings"];
  if (!payload || !actions.includes(payload.action)) return json({ error: "invalid_action" }, 400);
  if (payload.action !== "settings" && (typeof payload.target !== "string" || !CHAT_UUID.test(payload.target))) return json({ error: "invalid_target" }, 400);
  if (["request", "send", "read"].includes(payload.action) && (typeof payload.clientId !== "string" || !CHAT_UUID.test(payload.clientId))) return json({ error: "invalid_client_id" }, 400);
  if (["request", "send", "report"].includes(payload.action) && (typeof payload.body !== "string" || !payload.body.trim() || payload.body.length > (payload.action === "report" ? 1000 : 2000))) return json({ error: "invalid_message" }, 400);
  if (payload.action === "settings" && typeof payload.value !== "boolean") return json({ error: "invalid_settings" }, 400);
  const admin = createChatAdminClient();
  if (!admin) return json({ error: "server_not_configured" }, 503);
  const { data, error } = await admin.rpc("longboard_chat_dm_action", {
    p_user_id: auth.user.id, p_action: payload.action, p_target: payload.action === "settings" ? null : payload.target,
    p_body: typeof payload.body === "string" ? payload.body : null,
    p_client_id: typeof payload.clientId === "string" ? payload.clientId : null,
    p_value: typeof payload.value === "boolean" ? payload.value : null,
  });
  if (error) {
    const key = Object.keys(DM_ERRORS).find((code) => error.message === code);
    return json({ error: key ? DM_ERRORS[key] : "Could not update your inbox. Please try again." }, key?.includes("rate_limited") ? 429 : 409);
  }
  return json(data);
}
