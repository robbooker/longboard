import { NextRequest, NextResponse } from "next/server";
import { createChatAdminClient, requestOriginAllowed } from "@/lib/chatAdmin";
import { requireChatUser } from "@/lib/chatAuth";
import { parseAnnouncementRequest, postAnnouncement } from "@/lib/chatLongboardBot";
import { publishRoomEventAfterResponse } from "@/lib/chatRealtimePublish";
import { isChatAdmin } from "@/lib/chatRole";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/**
 * #413: a chat admin posts an announcement as "Longboard Bot".
 * Body: { rooms: "all" | ["main", ...], body: "text", clientId?: uuid }. "all" is every room except
 * Gainers (ANNOUNCE_ROOMS). The same clientId (or, without one, the same text) never posts twice in a
 * room, so a retry is safe. Answers 200 with one result per room when every room posted or already
 * had it, 207 when some failed.
 */
export async function POST(request: NextRequest) {
  if (!requestOriginAllowed(request)) return json({ error: "origin_not_allowed" }, 403);
  const auth = await requireChatUser(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  // People only: an API token (and so a bot) never announces.
  if (auth.apiToken || !isChatAdmin(auth)) return json({ error: "admin_only" }, 403);
  const text = await request.text().catch(() => null);
  if (text === null) return json({ error: "invalid_body" }, 400);
  if (text.length > 32768) return json({ error: "payload_too_large" }, 413);
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const parsed = parseAnnouncementRequest(payload);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const db = createChatAdminClient();
  if (!db) return json({ error: "announce_unavailable" }, 503);
  const results = await postAnnouncement(db, parsed.value);
  for (const result of results)
    if (result.status === "posted")
      publishRoomEventAfterResponse(result.room, { kind: "changed", topics: ["history"] });
  const failed = results.some((result) => result.status === "failed");
  return json({ clientId: parsed.value.clientId, results }, failed ? 207 : 200);
}
