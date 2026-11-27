// #535 Booker Stock Club: the chat opens to everyone in the room while a webinar is live there, and
// is read-only for members again when it ends. The rule itself, with no imports that need a server
// (the page uses the wording). The server's side is lib/chatClubLiveServer.ts.
//
// WHEN THE CHAT IS OPEN (decided on the server only, never from anything a page sends):
//  1. LiveKit says the club's broadcast is playing (the same remembered answer the LIVE button
//     uses, asked of LiveKit at most once every few seconds per server): open, from that moment.
//     Nothing waits for the room's "live now" message to be posted.
//  2. LiveKit says nothing is playing, but the club's announced broadcast has not been marked
//     ended yet: still open. A broadcast that stops is given 20 seconds to come back
//     (STAGE_DROP_GRACE_MS, lib/chatStageNotify.ts) before its message says it ended, so a short
//     drop never locks anyone out mid-sentence, and one that returns inside that time never locks
//     the chat at all.
//  3. Otherwise read-only, as before #535. So the chat locks when the broadcast's message is marked
//     ended: about 20 seconds after the broadcast stops (20 seconds plus the moment it takes the
//     server to hear of the stop and write it down; normally well under half a minute). Every page
//     showing the room is told at that moment and puts the read-only notice back.
// A broadcast that comes back later (even within the 10 minutes in which it counts as the same
// broadcast) opens the chat again by rule 1.
import type { StageState } from "./chatStageLive";

/** What a member is told when a post, reply or edit is refused in the club at rest (as before #535). */
export const CLUB_READ_ONLY = "Booker Stock Club is a read-only channel.";
/** ...and when it is refused because the webinar ended a moment ago. */
export const CLUB_WEBINAR_ENDED = "The webinar has ended, so Booker Stock Club is read-only again. Your message was not posted.";
/** A refusal says "the webinar has ended" for this long after the end; after that it is simply read-only. */
export const CLUB_ENDED_RECENT_MS = 10 * 60_000;
/** The read-only footer's line about webinars (the page adds it to what the footer already said). */
export const CLUB_CHAT_OPENS_LIVE = "Chat opens here for everyone during a live webinar.";

/** The club's latest announced broadcast, as far as this rule needs it (ms; `endedAt` null: not marked ended). */
export type ClubBroadcast = { endedAt: number | null };

export type ClubChat = {
  /** Members may post, reply, edit and delete their own right now. */
  open: boolean;
  /** Closed, and a webinar ended within CLUB_ENDED_RECENT_MS (for the wording of a refusal). */
  ended: boolean;
};

/**
 * The rule above. `state` is LiveKit's (remembered) answer for the club; `last` is the club's latest
 * announced broadcast, or null when there is none or it could not be read (which never opens the chat).
 */
export function clubChat(state: StageState, last: ClubBroadcast | null, now: number): ClubChat {
  if (state === "live") return { open: true, ended: false };
  if (last && last.endedAt === null) return { open: true, ended: false };
  return { open: false, ended: !!last && last.endedAt !== null && now >= last.endedAt && now - last.endedAt < CLUB_ENDED_RECENT_MS };
}
