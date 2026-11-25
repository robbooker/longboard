// #508: the raised hands of each live video connection open on this page, kept where the top bar,
// the admin's list and (later) the phone viewing room can all read them. stageFeedConnect() wraps
// every connection with withStageHands(), so the player itself knows nothing about hands.
// Keyed by the LiveKit room ("chat-<room>"); the room and this viewer's own identity are read from
// the viewer token the server just issued for the connection.
import type { StageHandParticipant } from "@/lib/chatStageHand";
import type { StageFeedConnect } from "./stageFeed";

/** `identity`: this viewer's own connection (null: not connected). `participants`: who has a hand up. */
export type StageHandsSnapshot = { identity: string | null; participants: readonly StageHandParticipant[] };
const NONE: StageHandsSnapshot = { identity: null, participants: [] };

const rooms = new Map<string, { owner: object; snapshot: StageHandsSnapshot }>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

export const subscribeStageHands = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
export const stageHandsSnapshot = (videoRoom: string): StageHandsSnapshot => rooms.get(videoRoom)?.snapshot ?? NONE;
export const noStageHands = () => NONE;

/** The LiveKit room and identity a viewer token is for (its "video.room" and "sub"), or null. */
export function stageTokenViewer(token: string): { videoRoom: string; identity: string } | null {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, "="))) as { sub?: unknown; video?: { room?: unknown } };
    return typeof claims.sub === "string" && claims.sub && typeof claims.video?.room === "string" && claims.video.room
      ? { videoRoom: claims.video.room, identity: claims.sub }
      : null;
  } catch {
    return null;
  }
}

/**
 * The same connection, also keeping the room's raised hands in the store: from the moment it is
 * connected until it is closed, ends or fails. A connection made afterwards is a new participant
 * with a new identity, so it always starts with the hand down.
 */
export const withStageHands = (connect: StageFeedConnect): StageFeedConnect => async (options) => {
  const viewer = stageTokenViewer(options.token);
  if (!viewer) return connect(options);
  const owner = {};
  let open = true;
  let participants: readonly StageHandParticipant[] = [];
  const publish = () => {
    if (!open) return;
    rooms.set(viewer.videoRoom, { owner, snapshot: { identity: viewer.identity, participants } });
    changed();
  };
  const clear = () => {
    open = false;
    if (rooms.get(viewer.videoRoom)?.owner !== owner) return;
    rooms.delete(viewer.videoRoom);
    changed();
  };
  try {
    const feed = await connect({
      ...options,
      events: {
        ...options.events,
        connection: (state) => {
          if (state === "ended" || state === "failed") clear();
          options.events.connection(state);
        },
        hands: (next) => {
          participants = next;
          // Before the connection is made, only remembered: the store says "connected" once it is.
          if (rooms.get(viewer.videoRoom)?.owner === owner) publish();
          options.events.hands?.(next);
        },
      },
    });
    publish();
    return {
      ...feed,
      close: () => {
        clear();
        feed.close();
      },
    };
  } catch (error) {
    clear();
    throw error;
  }
};
