// #502: what the stage's player asks of a live video connection. The real one is stageLiveKit.ts
// (LiveKit, loaded only when a connection is actually made); keeping the player behind this small
// shape keeps livekit-client out of everything else, and lets the browser tests stand in for it.
import type { StageHandParticipant } from "@/lib/chatStageHand";
import { withStageHands } from "./stageHandStore";

export type StageFeedEvents = {
  /** The broadcast's picture is attached to the video element (true), or has gone (false). */
  video(on: boolean): void;
  /** People watching, the broadcast itself not counted. */
  viewers(count: number): void;
  /** The browser is holding the sound back until the viewer taps (autoplay rules). */
  audioBlocked(blocked: boolean): void;
  /**
   * "connected": in the LiveKit room. "reconnecting": LiveKit is retrying by itself.
   * "ended": LiveKit closed the room. "failed": the connection was lost for good.
   * #522 "removed": the server removed this viewer (their access changed). "replaced": another of
   * the member's own screens took this connection's seat (a member has two per room).
   */
  connection(state: "connected" | "reconnecting" | "ended" | "failed" | "removed" | "replaced"): void;
  /**
   * #508: everyone in the LiveKit room with a raised hand (this viewer included), told again each
   * time it changes. Optional: stageFeedConnect() below listens for it, the player need not.
   */
  hands?(participants: StageHandParticipant[]): void;
};

export type StageFeed = {
  /** Call from a tap: lets the browser play the sound. */
  startAudio(): Promise<void>;
  /** 0 to 1. */
  setVolume(volume: number): void;
  close(): void;
};

export type StageFeedConnect = (options: {
  url: string;
  token: string;
  video: HTMLVideoElement;
  audio: HTMLAudioElement;
  /** #511: aborted when the player lets go, even in the middle of connecting. */
  signal: AbortSignal;
  events: StageFeedEvents;
}) => Promise<StageFeed>;

/** The connection to use: LiveKit. (Outside a production build, a browser test may supply its own.) */
export async function stageFeedConnect(): Promise<StageFeedConnect> {
  if (process.env.NODE_ENV !== "production") {
    const fake = (window as unknown as { __chatStageFeedForTests?: StageFeedConnect }).__chatStageFeedForTests;
    if (fake) return withStageHands(fake);
  }
  // #508: every connection made here also keeps the room's raised hands (stageHandStore.ts).
  return withStageHands((await import("./stageLiveKit")).connectStageFeed);
}
