import { NextRequest, NextResponse } from "next/server";
import { canAccessChatRoom } from "@/lib/chatAccess";
import { requireChatUser } from "@/lib/chatAuth";
import { isChatAdmin } from "@/lib/chatRole";
import { stageCloseAfterResponse } from "@/lib/chatStageChange";
import { stageVideoApi } from "@/lib/chatStageLiveKit";
import { stageNoticeAfterResponse } from "@/lib/chatStageNotifyServer";
import {
  parseStageRoom,
  readStageOnScreen,
  readStageState,
  sharedStageOnScreen,
  sharedStageState,
  stageNoticeCheckDue,
  stageNoticeFollowUpDue,
  stageStopSeen,
  stageVideoConfig,
} from "@/lib/chatStageVideo";
import type { ChatRoom } from "@/lib/publicChat";
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
 * #521: that check can be lost (it runs after the response), so one that has not reported back is
 * run again by the room's next status answer; see lib/chatStageVideo.ts.
 *
 * #505: Dual, Quad and Six view ask for all the rooms on their cards in one request
 * (`?rooms=main,gainers`, answered as `states`, with no `onScreen`: a card only shows the button);
 * a room the member cannot read is simply left out.
 * The same check runs for these reads, but for at most one room per request (the others wait for
 * their next read), so a page of cards never sets off a burst of LiveKit calls. A room that merely
 * has its permanent key is "waiting" here, never "live": its card shows no button.
 *
 * #523, so that ordinary chat pays nothing for live video between broadcasts:
 *  - "waiting" and "off" are remembered for half a minute for an ordinary room open or switch
 *    (STAGE_SETTLED_MEMORY_MS). A page that asks because something told it to (a "stage" signal, its
 *    own player, a stage link, coming back to the tab) adds `fresh=1` and is answered from the
 *    few-second memory only, so a signal is never answered with a stale "waiting";
 *  - the stock on screen is read only while the room is live (and, for an admin, while it waits);
 *  - a room that has simply been waiting all along is not looked at once a minute.
 * #522: the room named must be there, as text (400 otherwise); and when this server, which had
 * read "live", reads that the broadcast has stopped, the LiveKit room is closed half a minute later
 * if it is still stopped (lib/chatStageChange.ts).
 */
const MOST_ROOMS = 8;
const MOST_NOTICE_CHECKS = 1;
export async function GET(req: NextRequest) {
  const auth = await requireChatUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const several = req.nextUrl.searchParams.get("rooms");
  // #523: asked because of a signal (see above): never answered from the long memory.
  const longMemory = req.nextUrl.searchParams.get("fresh") !== "1";
  if (several !== null) {
    const rooms = [...new Set(several.split(",").map(parseStageRoom))]
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
          ? await sharedStageState(
              room,
              async () => {
                const read = await readStageState(api, room);
                if (checks < MOST_NOTICE_CHECKS && stageNoticeCheckDue(room, read)) {
                  checks += 1;
                  stageNoticeAfterResponse(room, api, null, { tellRoom: true });
                }
                // #522 (kept apart from the message's check above): a stop this server saw closes the room.
                if (stageStopSeen(room, read)) stageCloseAfterResponse(room, api);
                return read;
              },
              undefined,
              { longMemory },
            )
          : "off";
      }),
    );
    // #521: a look that never reported back is run again, within the same one-per-request limit.
    if (api)
      for (const room of rooms)
        if (checks < MOST_NOTICE_CHECKS && stageNoticeFollowUpDue(room)) {
          checks += 1;
          stageNoticeAfterResponse(room, api, null, { tellRoom: true });
        }
    return json({ states, video: !!config });
  }
  const room = parseStageRoom(req.nextUrl.searchParams.get("room"));
  if (!room) return json({ error: "invalid_room" }, 400);
  if (!canAccessChatRoom(auth.access, room)) return json({ error: "room_forbidden" }, 403);
  const config = stageVideoConfig();
  if (!config) return json({ state: "off", video: false });
  const api = stageVideoApi(config);
  let looked = false;
  const state = await sharedStageState(
    room,
    async () => {
      const read = await readStageState(api, room);
      if (stageNoticeCheckDue(room, read)) {
        looked = true;
        stageNoticeAfterResponse(room, api, null, { tellRoom: true });
      }
      // #522 (kept apart from the message's check above): a stop this server saw closes the room.
      if (stageStopSeen(room, read)) stageCloseAfterResponse(room, api);
      return read;
    },
    undefined,
    { longMemory },
  );
  // #521: a look at the message that never reported back (it runs after the response and can be
  // lost) is run again here, whether this answer was read from LiveKit or remembered. (#523: that
  // includes an answer from the half-minute memory of "waiting": an owed look never waits for it.)
  if (!looked && stageNoticeFollowUpDue(room)) stageNoticeAfterResponse(room, api, null, { tellRoom: true });
  // #523: only while live: nobody else is shown it, so a room at rest costs a member's page one
  // LiveKit call per memory window, not two. An admin (whose stage is open before the broadcast, and
  // who may put a stock on screen then) is still told while the room waits, from the long memory.
  const onScreen =
    state === "live"
      ? await sharedStageOnScreen(room, () => readStageOnScreen(api, room))
      : state === "waiting" && isChatAdmin(auth)
        ? await sharedStageOnScreen(room, () => readStageOnScreen(api, room), undefined, { longMemory })
        : null;
  return json({ state, video: true, onScreen });
}
