import { NextRequest, NextResponse } from "next/server";
import { canAccessChatRoom } from "@/lib/chatAccess";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { requireChatUser } from "@/lib/chatAuth";
import { isChatAdmin } from "@/lib/chatRole";
import { isStageRoom } from "@/lib/chatStageLive";
import { stageRecordingUrl } from "@/lib/chatStageRecording";
import { setStageRecording } from "@/lib/chatStageRecordingServer";
import { stageBody, stageOriginAllowed } from "@/lib/chatStageRequest";
import { parseStageRoom } from "@/lib/chatStageVideo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * #524: an admin adds, changes or removes the recording link on a room's ended live-video notice
 * ({ room, message, url }; url null removes it). Chat admins only, signed in through the browser
 * (never an API token or an agent), from this site's own pages (#522's stricter check), for a room
 * that offers live video. The link must
 * be a YouTube or Loom video link (the recordings rooms' own check); what is stored is rebuilt from
 * its video id. The notice's words change and everyone showing the room sees it; nobody is notified.
 */
export async function POST(req: NextRequest) {
  if (!stageOriginAllowed(req)) return json({ error: "origin_not_allowed" }, 403);
  const body = await stageBody(req);
  const auth = await requireChatUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  if (!isChatAdmin(auth) || auth.apiToken || auth.agent) return json({ error: "admin_only" }, 403);
  // #522: the body must be a JSON object that names its room, as text.
  const room = parseStageRoom(body?.room);
  if (!room || !body) return json({ error: "invalid_room" }, 400);
  if (!isStageRoom(room)) return json({ error: "stage_not_offered" }, 404);
  if (!canAccessChatRoom(auth.access, room)) return json({ error: "room_forbidden" }, 403);
  if (typeof body.message !== "string" || !UUID.test(body.message)) return json({ error: "invalid_message" }, 400);
  const url = body.url === null ? null : stageRecordingUrl(body.url);
  if (body.url !== null && !url) return json({ error: "invalid_link" }, 400);
  const db = createChatAdminClient();
  if (!db) return json({ error: "unavailable" }, 503);
  try {
    if (!(await setStageRecording(db, room, body.message, url, { source: "admin" }))) return json({ error: "not_ended_notice" }, 409);
  } catch {
    return json({ error: "unavailable" }, 503);
  }
  return json({ ok: true, url });
}
