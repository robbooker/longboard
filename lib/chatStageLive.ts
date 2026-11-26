// #502 Stage mode's live video: the few pieces every room view needs (the state, who may open the
// stage, the window event). Kept apart from lib/chatStageMode.ts so the room's first load does not
// carry the stage's stock panel code. No imports on purpose.

/**
 * #502: a room's live video, as LiveKit has it. "live": the broadcast is playing. "waiting": the
 * room has its stream address and key and nothing is being broadcast (#512: where a room rests
 * between broadcasts, for good once an admin has opened its "Live video" card). "off": the room has
 * never been set up. A member is shown the same for "waiting" and "off": nothing.
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

/**
 * #509: a phone, held either way up (a touch screen that is narrow, or short and on its side). The
 * stage there is the viewing room: only the video, with the room's chat on a button.
 */
export const STAGE_PHONE_QUERY =
  "(pointer: coarse) and (max-width: 40rem), (pointer: coarse) and (orientation: landscape) and (max-height: 31.25rem)";

/**
 * #509: who may open the phone's viewing room. It only ever shows the real video, so there is no
 * admin preview: a member while the room is live (as on a computer), an admin once the room has
 * its stream key (#512: there the admin waits with no connection until the broadcast is live).
 */
export function stagePhoneReachable(viewer: { admin: boolean; video: boolean }, state: StageState) {
  return viewer.video && (state === "live" || (viewer.admin && state === "waiting"));
}

/** #502: window event after the broadcast starts or stops, or an admin sets up or resets a room's stream key. */
export const CHAT_STAGE_EVENT = "chat-stage-event";
/** #507: `onScreen` rides along when the signal is the host setting or clearing the stock on screen. */
export type ChatStageEventDetail = { room: string; onScreen?: StageOnScreen };

/**
 * #507: the stock the host put on screen for everyone watching a room's stage. `symbol` null: the
 * host cleared it. `at` is when it was set (ms): the newest one wins, so a slower, older answer can
 * never put back a stock the host has already replaced.
 */
export type StageOnScreen = { symbol: string | null; at: number };

/**
 * #507: a ticker as the host types it: 1 to 5 letters, with an optional share-class suffix of 1 or 2
 * letters after a dot or a dash ("BRK.B", "brk-b"). Upper-cased, and the dash becomes a dot, which is
 * how the Gainers Table and Polygon write a class. Anything else is null.
 */
export function parseStageTicker(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ticker = value.trim().toUpperCase().replace("-", ".");
  return /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/.test(ticker) ? ticker : null;
}

/** #507: what the server or a signal says is on screen, or null when it says nothing usable. */
export function parseStageOnScreen(value: unknown): StageOnScreen | null {
  if (!value || typeof value !== "object") return null;
  const { symbol, at } = value as { symbol?: unknown; at?: unknown };
  if (typeof at !== "number" || !Number.isFinite(at) || at <= 0) return null;
  if (symbol === null) return { symbol: null, at };
  const ticker = parseStageTicker(symbol);
  return ticker && ticker === symbol ? { symbol: ticker, at } : null;
}

/** #507: the newer of what is known and what just arrived (the same age: what just arrived). */
export const newerStageOnScreen = (known: StageOnScreen | null, next: StageOnScreen | null) =>
  next && (!known || next.at >= known.at) ? next : known;
