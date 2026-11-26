import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createChatAdminClient, requestOriginAllowed } from "@/lib/chatAdmin";
import { forgetChatUser } from "@/lib/chatSessionCache";
import { removeStageViewerAfterResponse } from "@/lib/chatStageRemove";
export async function POST(req: NextRequest) {
  const json = (data: unknown, status = 200) =>
    NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
  if (!requestOriginAllowed(req)) return json({ error: "origin_not_allowed" }, 403);
  // Only the current LB login can revoke its own membership bridge.
  const auth = await getCurrentUser();
  if (!auth.ok) return json({ error: "longboard_login_required" }, 401);
  const db = createChatAdminClient();
  if (!db) return json({ error: "unavailable" }, 503);
  const { error } = await db.rpc("revoke_chat_shortscout_membership_link", { p_lb_user: auth.user.id });
  if (error) return json({ error: "unlink_unavailable" }, 503);
  // #489: the cached chat sign-in carries the ShortScout link, so drop it on this instance.
  forgetChatUser(auth.user.id);
  // #522: any live video they were watching through that membership is closed; their player asks
  // for a new token, given only for rooms they may still watch (best effort, after the response).
  removeStageViewerAfterResponse(auth.user.id);
  return json({ ok: true });
}
