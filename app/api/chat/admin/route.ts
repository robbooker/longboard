import { NextRequest, NextResponse } from "next/server";
import { readPublicRoomState, requestOriginAllowed, requireChatOwner } from "@/lib/chatAdmin";
import { parseChatRoom } from "@/lib/publicChat";
import { requireChatUser } from "@/lib/chatAuth";
import { canAccessChatRoom } from "@/lib/chatAccess";
import { generateChatSummary } from "@/lib/chatSummary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  const roomSlug = parseChatRoom(req.nextUrl.searchParams.get("room"));
  if (!roomSlug) return json({ error: "invalid_room" }, 400);
  const access=await requireChatUser(req);
  if(!access.ok)return json({error:access.error},access.status);
  if(!canAccessChatRoom(access.access,roomSlug))return json({error:"room_forbidden"},403);
  const owner = await requireChatOwner(req);
  if (!owner.ok) {
    if (owner.status === 401 || owner.status === 403) return json({ isOwner: false });
    return json({ error: owner.error }, owner.status);
  }

  const [room, summariesResult] = await Promise.all([
    readPublicRoomState(owner.admin, roomSlug),
    owner.admin
      .from("longboard_chat_summaries")
      .select("id, summary_date, message_count, model, summary_text, updated_at")
      .eq("room_slug", roomSlug)
      .order("summary_date", { ascending: false })
      .limit(7),
  ]);
  if (summariesResult.error) return json({ error: "summaries_unavailable" }, 500);
  return json({ isOwner: true, room, summaries: summariesResult.data ?? [] });
}

export async function POST(req: NextRequest) {
  if (!requestOriginAllowed(req)) return json({ error: "origin_not_allowed" }, 403);
  const roomSlug = parseChatRoom(req.nextUrl.searchParams.get("room"));
  if (!roomSlug) return json({ error: "invalid_room" }, 400);
  const access=await requireChatUser(req);
  if(!access.ok)return json({error:access.error},access.status);
  if(!canAccessChatRoom(access.access,roomSlug))return json({error:"room_forbidden"},403);
  const owner = await requireChatOwner(req);
  if (!owner.ok) return json({ error: owner.error }, owner.status);

  let payload: { action?: unknown; isOpen?: unknown; reason?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  if (payload.action === "set_room_open") {
    if (typeof payload.isOpen !== "boolean") return json({ error: "invalid_room_state" }, 400);
    const reason = typeof payload.reason === "string" ? payload.reason.trim().slice(0, 240) : "";
    const now = new Date().toISOString();
    const { error } = await owner.admin
      .from("longboard_chat_room_state")
      .update(payload.isOpen ? {
        is_open: true,
        paused_at: null,
        paused_by: null,
        pause_reason: null,
        updated_at: now,
      } : {
        is_open: false,
        paused_at: now,
        paused_by: owner.user.id,
        pause_reason: reason || "Chat temporarily paused by Longboard.",
        updated_at: now,
      })
      .eq("room_slug", roomSlug);
    if (error) return json({ error: "room_state_save_failed" }, 500);

    const { error: auditError } = await owner.admin.from("longboard_chat_admin_events").insert({
      room_slug: roomSlug,
      owner_user_id: owner.user.id,
      action: payload.isOpen ? "reopen" : "pause",
      reason: payload.isOpen ? null : reason || null,
    });
    if (auditError) console.error("[api/chat/admin] audit write failed", auditError);
    return json({ isOwner: true, room: await readPublicRoomState(owner.admin, roomSlug) });
  }

  if (payload.action === "summarize_now") {
    try {
      const result = await generateChatSummary(undefined, roomSlug);
      const { error: auditError } = await owner.admin.from("longboard_chat_admin_events").insert({
        room_slug: roomSlug,
      owner_user_id: owner.user.id,
        action: "summary_generate",
      });
      if (auditError) console.error("[api/chat/admin] summary audit write failed", auditError);
      return json({ isOwner: true, result });
    } catch (error) {
      console.error("[api/chat/admin] summary failed", error);
      return json({ error: error instanceof Error ? error.message : "summary_failed" }, 502);
    }
  }

  return json({ error: "unknown_action" }, 400);
}
