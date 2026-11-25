// #502 Stage mode's live video: the few pieces every room view needs (the state, who may open the
// stage, the window event). Kept apart from lib/chatStageMode.ts so the room's first load does not
// carry the stage's stock panel code. No imports on purpose.

/**
 * #502: a room's live video, as LiveKit has it. "off": not started. "waiting": an admin started it
 * and the broadcast has not arrived (or has dropped). "live": the broadcast is playing.
 */
export type StageState = "off" | "waiting" | "live";
export const parseStageState = (value: unknown): StageState => (value === "live" || value === "waiting" ? value : "off");

/**
 * #502: who may open the stage for a room. An admin (stageModeAllowed) always. A member only when
 * live video is set up on this server AND that room is live right now; the server checks the same
 * thing again, with the room's membership check, before it hands out a viewer token.
 */
export function stageReachable(viewer: { admin: boolean; video: boolean }, state: StageState) {
  return viewer.admin || (viewer.video && state === "live");
}

/** #502: the red LIVE button in the room header: anyone who can read the room, only while it is live. */
export function stageLiveBadge(video: boolean, state: StageState) {
  return video && state === "live";
}

/** #502: window event after an admin starts or ends a room's live video, or the broadcast starts or stops. */
export const CHAT_STAGE_EVENT = "chat-stage-event";
export type ChatStageEventDetail = { room: string };
