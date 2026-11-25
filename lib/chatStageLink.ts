// #511 Stage mode: when a viewer's player holds a LiveKit connection, and when it lets go.
// LiveKit counts every connected viewer by the minute, so a player is connected only while there is
// (or is about to be) something to watch. This file is the whole rule, with no React and no LiveKit
// in it: the player (components/chat/stage/StageVideo.tsx) feeds it what it knows and connects while
// `open` is true. No imports besides a type on purpose.
import type { StageState } from "./chatStageLive";

/** A connection with no picture (the broadcast dropped, or never arrived) is kept this long. */
export const STAGE_GRACE_MS = 25_000;
/** A tab nobody is looking at or listening to is disconnected after this long. */
export const STAGE_HIDDEN_MS = 5 * 60_000;

export type StageLinkInput = {
  /** Live video is set up on the server. */
  video: boolean;
  /** The room's status, as the server last answered. */
  state: StageState;
  /** The broadcast's picture is playing in this player. */
  picture: boolean;
  /** The connection is already gone for good (failed, or closed by the server): nothing to let go of. */
  dead: boolean;
  /** The page is hidden (a background tab, a minimised window). */
  hidden: boolean;
  /** Still being watched while hidden: picture-in-picture, or its sound is playing. */
  watching: boolean;
  /** A "stage" signal for this room arrived since the last step. */
  signal?: boolean;
};

export type StageLinkMemory = {
  /** Hold a connection now. */
  open: boolean;
  /**
   * Why it was let go: "gone" (no picture for too long: comes back when the room goes live again),
   * "hidden" (comes back when the tab does), or null.
   */
  closed: "gone" | "hidden" | null;
  /** Since when the connection has had no picture. */
  idleSince: number | null;
  /** Since when the tab has been hidden with nobody watching. */
  hiddenSince: number | null;
  /** Let go while the status still said "live": only a new signal, or a new "live", connects again. */
  closedLive: boolean;
};

export const STAGE_LINK_IDLE: StageLinkMemory = { open: false, closed: null, idleSince: null, hiddenSince: null, closedLive: false };

/**
 * One step: what to do now, and when to ask again (`wake`, ms since epoch; null when nothing is
 * being timed). Call it whenever an input changes and when `wake` comes round.
 *  - Off, or live video not set up: never connected.
 *  - Anyone connects only while the room is live. #512: an admin too. A room keeps its stream key
 *    for good, so a room that is merely set up ("waiting") is no reason to hold a connection; the
 *    room's status and its "stage" signal say when the broadcast arrives.
 *  - No picture for the grace: let go. It connects again when the room is next reported live.
 *  - Hidden and not being watched for long enough: let go, until the tab is back.
 */
export function stageLinkStep(memory: StageLinkMemory, input: StageLinkInput, now: number): { memory: StageLinkMemory; wake: number | null } {
  if (!input.video || input.state === "off") return { memory: STAGE_LINK_IDLE, wake: null };
  const next = { ...memory };
  const away = input.hidden && !input.watching;
  next.hiddenSince = away ? (next.hiddenSince ?? now) : null;
  if (next.closed === "hidden" && !away) next.closed = null;
  if (next.closed === "gone") {
    if (input.state !== "live") next.closedLive = false;
    else if (!next.closedLive || input.signal) next.closed = null;
  }
  // A connection begins when the room is live, and then rides out a short drop.
  const may = input.state === "live" || memory.open;
  if (next.closed || !may) return { memory: { ...next, open: false, idleSince: null }, wake: null };
  next.open = true;
  next.closedLive = false;
  next.idleSince = input.picture || input.dead ? null : (next.idleSince ?? now);
  const idleUntil = next.idleSince === null ? null : next.idleSince + STAGE_GRACE_MS;
  const hiddenUntil = next.hiddenSince === null ? null : next.hiddenSince + STAGE_HIDDEN_MS;
  if (idleUntil !== null && now >= idleUntil)
    return { memory: { ...next, open: false, closed: "gone", idleSince: null, closedLive: input.state === "live" }, wake: null };
  if (hiddenUntil !== null && now >= hiddenUntil) return { memory: { ...next, open: false, closed: "hidden", idleSince: null }, wake: null };
  const wake = idleUntil === null ? hiddenUntil : hiddenUntil === null ? idleUntil : Math.min(idleUntil, hiddenUntil);
  return { memory: next, wake };
}

/**
 * One connection attempt that can always be let go of, whatever it is in the middle of. `open` gets
 * the token and connects (null: there is nothing to connect to); the function returned closes it,
 * once, however often it is called: before the token arrived, while connecting (the signal is
 * aborted, and a connection that still arrives is closed at once) or after. Nothing is reported
 * (`ready`, `failed`) after the close.
 */
export function holdStageConnection<C extends { close(): void }>(
  open: (signal: AbortSignal) => Promise<C | null>,
  ready: (connection: C) => void,
  failed: () => void,
): () => void {
  const controller = new AbortController();
  let connection: C | null = null;
  open(controller.signal).then(
    (made) => {
      if (!made) return;
      if (controller.signal.aborted) return made.close();
      connection = made;
      ready(made);
    },
    () => {
      if (!controller.signal.aborted) failed();
    },
  );
  return () => {
    if (controller.signal.aborted) return;
    controller.abort();
    connection?.close();
    connection = null;
  };
}
