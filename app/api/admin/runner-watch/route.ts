import { requireAdmin } from "@/lib/auth";
import { createChatAdminClient, requestOriginAllowed } from "@/lib/chatAdmin";
import { publishRoomEventAfterResponse } from "@/lib/chatRealtimePublish";
import type { ChatRoom } from "@/lib/publicChat";
import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** #341: the admin page's two switches and "Post now". */
export async function POST(request: NextRequest) {
  if (!requestOriginAllowed(request)) return json({ error: "forbidden" }, 403);
  const auth = await requireAdmin(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const db = createChatAdminClient();
  if (!db) return json({ error: "unavailable" }, 503);
  if (body?.action === "settings") {
    const changes: { enabled?: boolean; alerts_only?: boolean; main_alerts_only?: boolean } = {};
    if (typeof body.enabled === "boolean") changes.enabled = body.enabled;
    if (typeof body.alertsOnly === "boolean") changes.alerts_only = body.alertsOnly;
    if (typeof body.mainAlertsOnly === "boolean") changes.main_alerts_only = body.mainAlertsOnly;
    if (!Object.keys(changes).length) return json({ error: "invalid_request" }, 400);
    const { error } = await db
      .from("chat_runner_watch_settings")
      .update({ ...changes, updated_at: new Date().toISOString(), updated_by: auth.user.id })
      .eq("id", true);
    return error ? json({ error: "unavailable" }, 503) : json({ ok: true });
  }
  if (body?.action === "post" && typeof body.id === "string" && UUID.test(body.id)) {
    const { data, error } = await db.rpc("release_chat_runner_watch", { p_id: body.id, p_admin_url: `${request.nextUrl.origin}/admin/runner-watch` });
    if (error) {
      if (error.message.includes("longboard_chat_paused")) return json({ error: "room_paused" }, 423);
      return json({ error: "unavailable" }, 503);
    }
    const { status, rooms, told } = data as { status: string; rooms?: string[]; told?: boolean };
    if (status === "posted")
      for (const room of ["runner-watch", ...(rooms ?? []), ...(told ? ["admins"] : [])] as ChatRoom[])
        publishRoomEventAfterResponse(room, { kind: "changed", topics: ["history"] });
    return status === "posted" ? json({ ok: true }) : json({ error: status }, 409);
  }
  return json({ error: "invalid_request" }, 400);
}
