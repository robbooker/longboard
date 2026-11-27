// #535 Booker Stock Club: whether the chat is open to members right now. Server only. The rule and
// its timing are lib/chatClubLive.ts; this file reads the two things the rule needs, both of which
// the stage code already keeps:
//  - LiveKit's answer for the club, through sharedStageState (lib/chatStageVideo.ts): the same
//    remembered answer the LIVE button and the hand route use, so however many people post during a
//    webinar this server asks LiveKit at most once every few seconds, never once per message;
//  - the club's latest announced broadcast (chat_stage_broadcasts, one small indexed read), and only
//    when LiveKit says nothing is playing, which during a webinar is only the seconds around a drop
//    or the end.
// Nothing a page sends is ever part of the answer.
import { canChatInClubWebinar, canWriteChatRoom, type ChatEntitlements, type ChatWriteSource } from "./chatAccess";
import { createChatAdminClient } from "./chatAdmin";
import { CLUB_READ_ONLY, CLUB_WEBINAR_ENDED, clubChat, type ClubBroadcast, type ClubChat } from "./chatClubLive";
import { stageCloseAfterResponse } from "./chatStageChange";
import type { StageState } from "./chatStageLive";
import { stageVideoApi } from "./chatStageLiveKit";
import { latestStageBroadcast, stageNoticeAfterResponse } from "./chatStageNotifyServer";
import {
  STAGE_SETTLED_MEMORY_MS,
  STAGE_STATE_MEMORY_MS,
  readStageState,
  sharedStageState,
  stageNoticeCheckDue,
  stageStopSeen,
  stageVideoConfig,
} from "./chatStageVideo";
import type { ChatRoom } from "./publicChat";

// "No webinar: the last one was marked ended (or there has never been one)" is remembered like the
// stage's own state: a few seconds for anything that decides (a post, a page asking because it was
// signalled), half a minute for an ordinary room open. An announced broadcast that is still open is
// never remembered (it is about to change), and seeing the club live forgets everything.
let settled: { at: number; last: ClubBroadcast | null } | null = null;
/** For tests. */
export const forgetClubChat = () => {
  settled = null;
};

async function latestClubBroadcast(now: number, longMemory: boolean): Promise<ClubBroadcast | null> {
  if (settled && now >= settled.at && now - settled.at < (longMemory ? STAGE_SETTLED_MEMORY_MS : STAGE_STATE_MEMORY_MS)) return settled.last;
  try {
    const db = createChatAdminClient();
    if (!db) return null;
    const row = await latestStageBroadcast(db, "club");
    const last = row ? { endedAt: row.endedAt } : null;
    settled = last && last.endedAt === null ? null : { at: now, last };
    return last;
  } catch {
    // Could not be read: nothing is known of a broadcast, which never opens the chat.
    return null;
  }
}

/**
 * The club's chat, given the state just read (or remembered) for the club. The status route calls
 * this with its own answer so a page is told with one read what the post routes would decide.
 * `longMemory`: an ordinary room open (see above).
 */
export async function clubChatFor(state: StageState, options?: { longMemory?: boolean; now?: number }): Promise<ClubChat> {
  const now = options?.now ?? Date.now();
  if (state === "live") {
    settled = null;
    return clubChat(state, null, now);
  }
  return clubChat(state, await latestClubBroadcast(now, options?.longMemory === true), now);
}

/**
 * The club's chat right now, for a route that is about to let a member write. With live video not
 * set up on this server the chat never opens. A fresh read of LiveKit here does what the status
 * route's does (the room's "live now" message is brought in line after the response, and a stop
 * this server saw closes the LiveKit room), so a broadcast whose end no webhook reported is still
 * marked ended, and the chat locked, once anyone tries to post.
 */
export async function clubChatNow(): Promise<ClubChat> {
  const config = stageVideoConfig();
  if (!config) return { open: false, ended: false };
  const api = stageVideoApi(config);
  const state = await sharedStageState("club", async () => {
    const read = await readStageState(api, "club");
    if (stageNoticeCheckDue("club", read)) stageNoticeAfterResponse("club", api, null, { tellRoom: true });
    if (stageStopSeen("club", read)) stageCloseAfterResponse("club", api);
    return read;
  });
  return clubChatFor(state);
}

export type ChatWrite = {
  allowed: boolean;
  /** Allowed only because a webinar is live in the club: the write goes through the club's webinar database functions. */
  webinar: boolean;
  /** Refused, and a webinar there ended a moment ago (for the wording). */
  ended: boolean;
};

/**
 * Who may write in a room right now. Everywhere but the club, and for the club's admins, this is
 * canWriteChatRoom and nothing is asked of anyone. For the club's other members (browser sign-in
 * only: never a bot account, an API token or an agent) it is whether a webinar is live.
 */
export async function chatWriteNow(access: ChatEntitlements, room: ChatRoom, source?: ChatWriteSource): Promise<ChatWrite> {
  if (canWriteChatRoom(access, room, source)) return { allowed: true, webinar: false, ended: false };
  if (room !== "club" || !canChatInClubWebinar(access, source)) return { allowed: false, webinar: false, ended: false };
  const chat = await clubChatNow();
  return { allowed: chat.open, webinar: chat.open, ended: chat.ended };
}

/** What a refused write in the club is told. */
export const clubRefusal = (write: Pick<ChatWrite, "ended">) => (write.ended ? CLUB_WEBINAR_ENDED : CLUB_READ_ONLY);
