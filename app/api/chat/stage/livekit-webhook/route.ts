import { NextRequest, NextResponse } from "next/server";
import { publishRoomEventAfterResponse } from "@/lib/chatRealtimePublish";
import { receiveStageWebhook, stageVideoApi } from "@/lib/chatStageLiveKit";
import { stageNoticeAfterResponse } from "@/lib/chatStageNotifyServer";
import { forgetStageState, stageVideoConfig, stageWebhookChange, stageWebhookIsNew, type StageVideoConfig } from "@/lib/chatStageVideo";
import type { ChatRoom } from "@/lib/publicChat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// #503: after the answer, a broadcast that stopped sending is given a few seconds to come back.
export const maxDuration = 60;
const answer = (status: number) => new NextResponse(null, { status, headers: { "Cache-Control": "no-store" } });

/**
 * The one place a room's live video is known to have come on or gone off, as LiveKit reports it:
 * forget the remembered status and tell everyone showing the room to ask again (the signal carries
 * no address or key), so the LIVE button appears the moment StreamYard starts sending and goes when
 * it stops. #512: with no Start or End button, this is how a broadcast begins and ends for everyone.
 * #503: then, after the answer is sent, the room's "live now" message, bell entries and phone
 * notifications (lib/chatStageNotify.ts). The webhook is only a hint: whether the room is live is
 * read from LiveKit there, and a broadcast is announced once however many webhooks, retries or
 * servers report it.
 */
function stageChanged(room: ChatRoom, config: StageVideoConfig) {
  forgetStageState(room);
  publishRoomEventAfterResponse(room, { kind: "changed", topics: ["stage"] });
  stageNoticeAfterResponse(room, stageVideoApi(config));
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
  if (change && stageWebhookIsNew(event.id)) stageChanged(change.room, config);
  return answer(200);
}
