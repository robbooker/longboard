"use client";
// #511/#509: a stage player's LiveKit connection, for the computer's player (StageVideo.tsx) and the
// phone's viewing room (StagePhone.tsx) alike. One rule decides when it is held and when it is let
// go (lib/chatStageLink.ts); this hook is the wiring around that rule: it watches the room's status,
// the page's visibility and the room's "stage" signals, gets a watch-only token, connects
// (stageFeed.ts) and closes again.
// #512: the same for everyone, an admin included: connected only while the room is live (a room
// that merely has its permanent stream key, "waiting", is no reason to hold a connection).
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { ChatRoom } from "@/lib/publicChat";
import { CHAT_STAGE_EVENT, type ChatStageEventDetail, type StageState } from "@/lib/chatStageLive";
import { STAGE_LINK_IDLE, holdStageConnection, stageLinkStep } from "@/lib/chatStageLink";
import { stageFeedConnect, type StageFeed } from "./stageFeed";

export type StageLink = "idle" | "connecting" | "connected" | "reconnecting" | "ended" | "failed";

/** #512: refused a token because the server does not (yet) say "live": asked again this much later, if the room is live. */
const STAGE_REFUSED_RETRY_MS = 5_000;

export function useStageLink({
  roomId,
  video,
  admin,
  stageState,
  onStageRefresh,
  videoRef,
  audioRef,
  volume,
  listening,
  pip,
  resume = false,
}: {
  roomId: ChatRoom;
  /** Live video is set up on the server. */
  video: boolean;
  /** #512: an admin's player asks the room's status once more as it opens. The connection rule is the same for everyone. */
  admin: boolean;
  stageState: StageState;
  /** Ask the server for the room's status again. */
  onStageRefresh: () => void;
  videoRef: RefObject<HTMLVideoElement | null>;
  audioRef: RefObject<HTMLAudioElement | null>;
  /** The sound to play now, 0 to 1 (0 while muted or paused). */
  volume: number;
  /** The viewer has the sound on (not muted, not paused): a hidden tab that plays it is still being watched. */
  listening: boolean;
  /** Playing in picture-in-picture. */
  pip: boolean;
  /**
   * #509, a phone: coming back to the page counts as a "stage" signal and retries a connection lost
   * for good. Phones stop background pages often, and a viewer who returns to a room that is still
   * live must not be left looking at "ended".
   */
  resume?: boolean;
}) {
  const feed = useRef<StageFeed | null>(null);
  const [link, setLink] = useState<StageLink>("idle");
  const [picture, setPicture] = useState(false);
  const [viewers, setViewers] = useState<number | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const refresh = useRef(onStageRefresh);
  refresh.current = onStageRefresh;
  const volumeNow = useRef(volume);
  volumeNow.current = volume;

  // #511: connected only while there is something to watch (lib/chatStageLink.ts has the rule).
  // A connection begins when the room is live and rides out a short drop. #512: an admin's too: a
  // room keeps its stream key for good, so an admin waits for the broadcast with no connection, and
  // the room's status says when it arrives. A tab left hidden lets go too, unless it is still being
  // watched there: picture-in-picture, or its sound is playing.
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const seenOrNot = () => setHidden(document.visibilityState === "hidden");
    seenOrNot();
    document.addEventListener("visibilitychange", seenOrNot);
    return () => document.removeEventListener("visibilitychange", seenOrNot);
  }, []);
  const watching = pip || (picture && listening && !audioBlocked);
  const dead = link === "failed" || link === "ended";
  const linkMemory = useRef(STAGE_LINK_IDLE);
  const signalled = useRef(false);
  const [hold, setHold] = useState<{ open: boolean; gone: boolean }>({ open: false, gone: false });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const signal = (event: Event) => {
      const detail = (event as CustomEvent<ChatStageEventDetail>).detail;
      // #507's signal for the stock on screen says nothing about the broadcast.
      if (detail?.room !== roomId || detail.onScreen) return;
      signalled.current = true;
      setTick((n) => n + 1);
    };
    window.addEventListener(CHAT_STAGE_EVENT, signal);
    return () => window.removeEventListener(CHAT_STAGE_EVENT, signal);
  }, [roomId]);
  useEffect(() => {
    const before = linkMemory.current;
    const { memory, wake } = stageLinkStep(
      before,
      { video, state: stageState, picture, dead, hidden, watching, signal: signalled.current },
      Date.now(),
    );
    signalled.current = false;
    linkMemory.current = memory;
    const gone = memory.closed === "gone";
    setHold((current) => (current.open === memory.open && current.gone === gone ? current : { open: memory.open, gone }));
    // Let go because nothing is playing: the room's status has probably changed.
    if (gone && before.closed !== "gone") refresh.current();
    if (wake === null) return;
    const timer = setTimeout(() => setTick((n) => n + 1), Math.max(0, wake - Date.now()) + 20);
    return () => clearTimeout(timer);
  }, [video, stageState, picture, dead, hidden, watching, tick]);
  const wanted = hold.open;
  // #512: an admin's stage waits with no connection, so what it knows is the room's status: asked
  // once more as the stage opens, in case a signal was missed while it was shut.
  useEffect(() => {
    if (admin && video) refresh.current();
  }, [admin, video]);
  // #512: a token was refused (409) although this player believed the room was live. Either its
  // status was out of date (the refresh corrects it, and nothing more happens until the room IS
  // live), or the server that answered was a few seconds behind: so once the status says live and a
  // few seconds have passed since the refusal, the token is asked for again.
  const [refusedAt, setRefusedAt] = useState<number | null>(null);
  useEffect(() => {
    if (refusedAt === null || stageState !== "live") return;
    const timer = setTimeout(
      () => {
        setRefusedAt(null);
        setAttempt((n) => n + 1);
      },
      Math.max(0, refusedAt + STAGE_REFUSED_RETRY_MS - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [refusedAt, stageState]);

  useEffect(() => {
    if (!wanted) return;
    const videoEl = videoRef.current;
    const audioEl = audioRef.current;
    if (!videoEl || !audioEl) return;
    setLink("connecting");
    setRefusedAt(null);
    // Let go of at any point (holdStageConnection): before the token, while connecting, or after.
    const close = holdStageConnection(
      async (signal) => {
        const open = () => !signal.aborted;
        const response = await fetch("/api/chat/stage/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ room: roomId }),
          signal,
        });
        if (!open()) return null;
        if (response.status === 409) {
          // Not live (any more): the room's status says what to show.
          setLink("idle");
          setRefusedAt(Date.now());
          refresh.current();
          return null;
        }
        if (!response.ok) throw new Error("token");
        const { url, token } = (await response.json()) as { url: string; token: string };
        const connect = await stageFeedConnect();
        if (!open()) return null;
        return connect({
          url,
          token,
          video: videoEl,
          audio: audioEl,
          signal,
          events: {
            video: (on) => {
              if (!open()) return;
              setPicture(on);
              // The broadcast arrived or dropped: the room's status has changed (or is about to).
              refresh.current();
            },
            viewers: (count) => open() && setViewers(count),
            audioBlocked: (blocked) => open() && setAudioBlocked(blocked),
            connection: (state) => {
              if (!open()) return;
              setLink(state);
              if (state === "ended" || state === "failed") refresh.current();
            },
          },
        });
      },
      (connection) => {
        feed.current = connection;
        connection.setVolume(volumeNow.current);
      },
      () => setLink("failed"),
    );
    // The page is going away (closed, navigated, or put in the back/forward cache): let go now.
    // If it is brought back from that cache, connect afresh.
    const leaving = () => {
      feed.current = null;
      close();
    };
    const returned = (event: PageTransitionEvent) => {
      if (event.persisted) setAttempt((n) => n + 1);
    };
    window.addEventListener("pagehide", leaving);
    window.addEventListener("pageshow", returned);
    return () => {
      window.removeEventListener("pagehide", leaving);
      window.removeEventListener("pageshow", returned);
      feed.current = null;
      close();
      setPicture(false);
      setViewers(null);
      setAudioBlocked(false);
      setLink("idle");
    };
  }, [wanted, roomId, attempt, videoRef, audioRef]);

  useEffect(() => feed.current?.setVolume(volume), [volume, link]);

  // #509: back on a phone's page (see `resume`).
  const linkNow = useRef(link);
  linkNow.current = link;
  useEffect(() => {
    if (!resume) return;
    const back = () => {
      if (document.visibilityState !== "visible") return;
      refresh.current();
      if (linkNow.current === "failed") setAttempt((n) => n + 1);
      signalled.current = true;
      setTick((n) => n + 1);
    };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("online", back);
    return () => {
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("online", back);
    };
  }, [resume]);

  /** Call from a tap: lets the browser play the sound. */
  const startAudio = useCallback(() => {
    void feed.current
      ?.startAudio()
      .then(() => setAudioBlocked(false))
      .catch(() => undefined);
  }, []);
  /** A new connection attempt after a failed one. */
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return {
    /** Holding (or making) a connection now: the player draws its video element while this is true. */
    wanted,
    link,
    /** The broadcast's picture is playing here. */
    picture,
    viewers,
    /** The browser is holding the sound back until the viewer taps. */
    audioBlocked,
    /** Let go because the broadcast stopped and did not come back (lib/chatStageLink.ts). */
    gone: hold.gone,
    startAudio,
    retry,
  };
}
