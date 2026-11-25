// #503 Stage mode: the words that tell a room its live video is on (the room message, the bell
// entry and the phone notification), and how the chat recognises that message again. No imports
// on purpose: the room, the bell and the server all read this file.

/** The room message is a Longboard Bot post (lib/chatLongboardBot.ts), like an announcement. */
export const STAGE_NOTICE_BOT = "longboard";
export const STAGE_NOTICE_AUTHOR = "Longboard Bot";
export const STAGE_WATCH_LABEL = "Watch live";
/** Shown in place of the link on a phone, where the stage is not available yet. */
export const STAGE_PHONE_HINT = "Watch on a computer for now.";

/** /chat?room=<room>&stage=1: the stage while the room is live, otherwise just the room. */
export const stageWatchPath = (room: string) => `/chat?room=${room}&stage=1`;

/** "LB is live now." Never a person's name: the broadcast arrives from StreamYard, not from an account. */
export const stageLiveLine = (roomName: string) => `${roomName} is live now.`;

/** The room message while the broadcast is on. The full address is for readers outside the app (the API). */
export function composeStageLiveNotice(roomName: string, origin: string, room: string) {
  return `🔴 ${stageLiveLine(roomName)} ${STAGE_WATCH_LABEL}: ${origin.replace(/\/+$/, "")}${stageWatchPath(room)}`;
}

/** What the same message says once the broadcast is over. */
export const composeStageEndedNotice = (roomName: string) => `The live video in ${roomName} has ended.`;

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

/** The phone notification. It quotes nobody, so it reads the same whatever the device's preview setting. */
export function stageLivePush(roomName: string, room: string) {
  return { title: stageLiveLine(roomName).slice(0, -1), body: `Live video has started. ${STAGE_PHONE_HINT}`, url: stageWatchPath(room) };
}

/** #503: a "Watch live" link in a room message was clicked (cancelled by the room when it opens the stage itself). */
export const CHAT_STAGE_OPEN_EVENT = "chat-stage-open";
