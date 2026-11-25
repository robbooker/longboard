import { NextRequest, NextResponse } from "next/server";
import { publishRoomEventAfterResponse } from "@/lib/chatRealtimePublish";
import { receiveStageWebhook } from "@/lib/chatStageLiveKit";
import { forgetStageState, stageVideoConfig, stageWebhookChange, stageWebhookIsNew } from "@/lib/chatStageVideo";
import type { ChatRoom } from "@/lib/publicChat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const answer = (status: number) => new NextResponse(null, { status, headers: { "Cache-Control": "no-store" } });

/**
 * The one place a room's live video is known to have come on or gone off, as LiveKit reports it.
 * Today: forget the remembered status and tell everyone showing the room to ask again (the same
 * signal an admin's start or end sends; it carries no address or key), so the LIVE button appears
 * the moment StreamYard starts sending and goes when it stops.
 * A later "tell members the room went live" step (a bell or a push) belongs here, under `live`;
 * it should first confirm with sharedStageState that the room really is live.
 */
function stageChanged(room: ChatRoom, live: boolean) {
  void live;
  forgetStageState(room);
  publishRoomEventAfterResponse(room, { kind: "changed", topics: ["stage"] });
}

/**
 * #502: LiveKit's webhook (POST /api/chat/stage/livekit-webhook; set it in the LiveKit project's
 * settings). No sign-in: the proof is LiveKit's signature over the raw body, made with this
 * project's API key and secret. Anything that fails that check is refused (401), and without the
 * LiveKit settings this address does not exist (404). The body and the Authorization header are
 * never logged, stored or sent on; only which room an event is about is used.
 */
export async function POST(req: NextRequest) {
  const config = stageVideoConfig();
  if (!config) return answer(404);
  const raw = await req.text();
  if (raw.length > 200_000) return answer(413);
  const event = await receiveStageWebhook(config, raw, req.headers.get("authorization"));
  if (!event) return answer(401);
  // Another project's room, an event that means nothing here, or one already handled: accepted, ignored.
  const change = stageWebhookChange(event);
  if (change && stageWebhookIsNew(event.id)) stageChanged(change.room, change.live);
  return answer(200);
}
