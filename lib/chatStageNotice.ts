// #503 Stage mode: the words that tell a room its live video is on (the room message, the bell
// entry and the phone notification), and how the chat recognises that message again. No imports
// on purpose: the room, the bell and the server all read this file.

/**
 * The room message is stored as a Longboard Bot post (lib/chatLongboardBot.ts), like an
 * announcement: the database only takes that bot's posts under the name "Longboard Bot".
 */
export const STAGE_NOTICE_BOT = "longboard";
export const STAGE_NOTICE_STORED_AUTHOR = "Longboard Bot";
/**
 * #504: the name the notice is shown under, everywhere a sender is named (the room, its thread,
 * search, the bell). Only this notice: the bot's other posts keep their stored name. It is a
 * reserved chat name (lib/publicChat.ts), so nobody can post under it.
 */
export const STAGE_NOTICE_AUTHOR = "Live Video";
export const STAGE_WATCH_LABEL = "Watch live";
/** #509: the phone notification's second line (a phone has its own viewing room now). */
export const STAGE_PUSH_HINT = "Tap to watch.";

/** /chat?room=<room>&stage=1: the stage while the room is live, otherwise just the room. */
export const stageWatchPath = (room: string) => `/chat?room=${room}&stage=1`;

/** "LB is live now." Never a person's name: the broadcast arrives from StreamYard, not from an account. */
export const stageLiveLine = (roomName: string) => `${roomName} is live now.`;

/** The room message while the broadcast is on. The full address is for readers outside the app (the API). */
export function composeStageLiveNotice(roomName: string, origin: string, room: string) {
  return `🔴 ${stageLiveLine(roomName)} ${STAGE_WATCH_LABEL}: ${origin.replace(/\/+$/, "")}${stageWatchPath(room)}`;
}

/** #524: the words in front of an ended notice's recording link, and on its player card. */
export const STAGE_RECORDING_LABEL = "Watch the recording";

/**
 * What the same message says once the broadcast is over. #524: until a recording is attached it
 * says one will follow; then it carries the recording's link (a checked YouTube or Loom address,
 * lib/chatStageRecording.ts), which the chat also shows as a player card.
 */
export const composeStageEndedNotice = (roomName: string, recordingUrl?: string | null) =>
  recordingUrl
    ? `The live video in ${roomName} has ended. ${STAGE_RECORDING_LABEL}: ${recordingUrl}`
    : `The live video in ${roomName} has ended. The recording will follow.`;

// The first form is what the message said before #524 (those messages are still in the rooms).
const ENDED_NOTICE = /^The live video in ([^\n]{1,60}) has ended\.(?: The recording will follow\.| Watch the recording: (https:\/\/[^\s]{1,280}))?$/;

/** #524: an ended notice: the room's name and its recording link (null: none yet). null for anything else. */
export function stageEndedNotice(body: string): { roomName: string; recordingUrl: string | null } | null {
  const match = ENDED_NOTICE.exec(body);
  return match ? { roomName: match[1], recordingUrl: match[2] ?? null } : null;
}
const LIVE_NOTICE = /^(🔴 ([^\n]{1,60}) is live now\. )Watch live: https?:\/\/[^\s/]+(\/chat\?room=([a-z0-9-]{1,40})&stage=1)$/;

/**
 * The "live now" message, split so the chat shows "Watch live" as a link that stays in the app.
 * null for anything else, the ended message included.
 */
export function stageLiveNotice(
  body: string,
): { before: string; label: string; href: string; room: string; roomName: string } | null {
  const match = LIVE_NOTICE.exec(body);
  return match ? { before: match[1], label: STAGE_WATCH_LABEL, href: match[3], room: match[4], roomName: match[2] } : null;
}

/**
 * #504: the sender name to show for a message: "Live Video" for the live notice and for what it
 * says once the broadcast is over (messages posted before this change included); null for every
 * other message, which keeps its own name.
 */
export function stageNoticeAuthor(botSlug: string | null | undefined, body: string | null | undefined): string | null {
  if (botSlug !== STAGE_NOTICE_BOT || typeof body !== "string") return null;
  return LIVE_NOTICE.test(body) || ENDED_NOTICE.test(body) ? STAGE_NOTICE_AUTHOR : null;
}

/** The phone notification. It quotes nobody, so it reads the same whatever the device's preview setting. */
export function stageLivePush(roomName: string, room: string) {
  return { title: stageLiveLine(roomName).slice(0, -1), body: `Live video has started. ${STAGE_PUSH_HINT}`, url: stageWatchPath(room) };
}

/** #503: a "Watch live" link in a room message was clicked (cancelled by the room when it opens the stage itself). */
export const CHAT_STAGE_OPEN_EVENT = "chat-stage-open";
