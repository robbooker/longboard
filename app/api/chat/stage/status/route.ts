import { NextRequest, NextResponse } from "next/server";
import { canAccessChatRoom } from "@/lib/chatAccess";
import { requireChatUser } from "@/lib/chatAuth";
import { stageVideoApi } from "@/lib/chatStageLiveKit";
import { stageNoticeAfterResponse } from "@/lib/chatStageNotifyServer";
import {
  readStageOnScreen,
  readStageState,
  sharedStageOnScreen,
  sharedStageState,
  stageNoticeCheckDue,
  stageVideoConfig,
} from "@/lib/chatStageVideo";
import { parseChatRoom, type ChatRoom } from "@/lib/publicChat";
import type { StageState } from "@/lib/chatStageLive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// #512: after the answer, a broadcast that stopped sending is given a few seconds to come back.
export const maxDuration = 60;
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/**
 * #502: whether one room's live video is live, waiting for a broadcast, or not set up. Asked by a page
 * only for the room it is showing (when the room opens, and when a "stage" signal arrives), and
 * answered from LiveKit at most once every few seconds per room by this server (sharedStageState).
 * Only someone who can read the room is told. Carries no address, key or token.
 * #507: for a room that has been set up, also the stock the host put on screen (`onScreen`, or
 * null), read from the LiveKit room and remembered for the same few seconds. A room that is off
 * asks LiveKit nothing more than before.
 * #512: nobody presses End any more, so when LiveKit's webhook for a broadcast stopping (or
 * starting) is missed, this is what notices: an answer freshly read from LiveKit that differs from
 * this server's last one (and otherwise once a minute per room) has the room's "live now" message
 * checked against LiveKit after the response, and if that changes the message, the room is told.
 *
 * #505: Dual, Quad and Six view ask for all the rooms on their cards in one request
 * (`?rooms=main,gainers`, answered as `states`, with no `onScreen`: a card only shows the button);
 * a room the member cannot read is simply left out.
 * The same check runs for these reads, but for at most one room per request (the others wait for
 * their next read), so a page of cards never sets off a burst of LiveKit calls. A room that merely
 * has its permanent key is "waiting" here, never "live": its card shows no button.
 */
const MOST_ROOMS = 8;
const MOST_NOTICE_CHECKS = 1;
export async function GET(req: NextRequest) {
  const auth = await requireChatUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const several = req.nextUrl.searchParams.get("rooms");
  if (several !== null) {
    const rooms = [...new Set(several.split(",").map(parseChatRoom))]
      .filter((room): room is ChatRoom => !!room && canAccessChatRoom(auth.access, room))
      .slice(0, MOST_ROOMS);
    const config = stageVideoConfig();
    const api = config && stageVideoApi(config);
    const states: Partial<Record<ChatRoom, StageState>> = {};
    // #512's check of the "live now" message, for at most one room per request.
    let checks = 0;
    await Promise.all(
      rooms.map(async (room) => {
        states[room] = api
          ? await sharedStageState(room, async () => {
              const read = await readStageState(api, room);
              if (checks < MOST_NOTICE_CHECKS && stageNoticeCheckDue(room, read)) {
                checks += 1;
                stageNoticeAfterResponse(room, api, null, { tellRoom: true });
              }
              return read;
            })
          : "off";
      }),
    );
    return json({ states, video: !!config });
  }
  const room = parseChatRoom(req.nextUrl.searchParams.get("room"));
  if (!room) return json({ error: "invalid_room" }, 400);
  if (!canAccessChatRoom(auth.access, room)) return json({ error: "room_forbidden" }, 403);
  const config = stageVideoConfig();
  if (!config) return json({ state: "off", video: false });
  const api = stageVideoApi(config);
  const state = await sharedStageState(room, async () => {
    const read = await readStageState(api, room);
    if (stageNoticeCheckDue(room, read)) stageNoticeAfterResponse(room, api, null, { tellRoom: true });
    return read;
  });
  const onScreen = state === "off" ? null : await sharedStageOnScreen(room, () => readStageOnScreen(api, room));
  return json({ state, video: true, onScreen });
}
