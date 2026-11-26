import { NextRequest, NextResponse } from "next/server";
import { isStageRoom } from "@/lib/chatStageLive";
import { stageMayHaveChanged } from "@/lib/chatStageChange";
import { receiveStageWebhook, stageVideoApi } from "@/lib/chatStageLiveKit";
import { stageVideoConfig, stageWebhookChange, stageWebhookIsNew } from "@/lib/chatStageVideo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// #503: after the answer, a broadcast that stopped sending is given a few seconds to come back.
export const maxDuration = 60;
const answer = (status: number) => new NextResponse(null, { status, headers: { "Cache-Control": "no-store" } });

/**
 * The one place a room's live video is known to have come on or gone off, as LiveKit reports it.
 * The webhook is only a hint: this server forgets the remembered status and reads the room's state
 * from LiveKit (lib/chatStageChange.ts), and when that state is new to it, tells everyone showing
 * the room to ask again (the signal carries no address or key), so the LIVE button appears the
 * moment StreamYard starts sending and goes when it stops. #512: with no Start or End button, this
 * is how a broadcast begins and ends for everyone. #503: then, after the answer is sent, the room's
 * "live now" message, bell entries and phone notifications (lib/chatStageNotify.ts).
 * #523: LiveKit reports a start, and a stop, as three events each; the room is told and its message
 * checked once per change of state, not once per event. #522: after a stop that lasts, the LiveKit
 * room is closed so nobody stays connected to it.
 */
/**
 * #502: LiveKit's webhook (POST /api/chat/stage/livekit-webhook; set it in the LiveKit project's
 * settings). No sign-in: the proof is LiveKit's signature over the raw body, made with this
 * project's API key and secret. Anything that fails that check is refused (401), and without the
 * LiveKit settings this address does not exist (404). The body and the Authorization header are
 * never logged, stored or sent on; only which room an event is about is used.
 * #522: an event with no id is refused (400): it could not be told from a repeat of itself.
 */
export async function POST(req: NextRequest) {
  const config = stageVideoConfig();
  if (!config) return answer(404);
  const raw = await req.text();
  if (raw.length > 200_000) return answer(413);
  const event = await receiveStageWebhook(config, raw, req.headers.get("authorization"));
  if (!event) return answer(401);
  if (!event.id) return answer(400);
  // Another project's room, an event that means nothing here, or one already handled: accepted, ignored.
  const change = stageWebhookChange(event);
  // #524: and a room that does not offer live video (a key made for it before that rule): ignored too.
  if (change && isStageRoom(change.room) && stageWebhookIsNew(event.id))
    await stageMayHaveChanged(change.room, stageVideoApi(config), { expect: change.live ? "live" : "stopped" });
  return answer(200);
}
