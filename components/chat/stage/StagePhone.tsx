"use client";
// #509 Stage mode on a phone: the viewing room. A dark full screen with only the live video and a
// few controls (back, the room's name, LIVE, who is watching, sound, full screen, Chat).
// "Chat" brings in the room's REAL chat: PublicChat keeps its message list, composer, outbox and
// typing indicator mounted where they are, and StagePhone.module.css lays that section out
//  - upright: under the video, which docks to the top of the screen;
//  - on its side: as a see-through panel over the right half of the video.
// Closing it gives the whole screen back to the video. Turning the phone only changes the styles:
// the video element and its connection stay as they are.
// Nothing else from the computer's stage is here (no stock panel, trades, questions, chapters,
// raise hand or broadcast controls). Downloaded only when someone opens it; livekit-client comes
// later still, when the connection is made (stageFeed.ts).
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatRoom, PublicChatMessage } from "@/lib/publicChat";
import type { StageState } from "@/lib/chatStageLive";
import { useStageLink, type StageLink } from "./useStageLink";
import styles from "./StagePhone.module.css";

/** What the viewing room is showing. */
export type StagePhoneView = "connecting" | "waiting" | "stopped" | "live" | "ended" | "error";
type Link = StageLink;

/** The one answer for what to show, from the room's status and this player's own connection. */
export function stagePhoneView(input: {
  state: StageState;
  link: Link;
  /** The broadcast's picture is playing here. */
  picture: boolean;
  /** The picture has played here since the room's video was started. */
  seen: boolean;
  /** This player let go of its connection because the broadcast stopped and did not come back. */
  gone: boolean;
}): StagePhoneView {
  if (input.picture) return "live";
  if (input.state === "off" || input.link === "ended" || input.gone) return "ended";
  if (input.link === "failed") return "error";
  if (input.link === "connecting" && input.state === "live") return "connecting";
  return input.seen ? "stopped" : "waiting";
}

/** Messages from other people that arrived after `since` (the newest one when the chat was closed). */
export function stagePhoneUnread(
  messages: readonly Pick<PublicChatMessage, "id" | "member_id">[],
  since: string | null,
  memberId: string | undefined,
) {
  if (since === null) return 0;
  const at = messages.findIndex((message) => message.id === since);
  // The marked message has gone (deleted, or the list was read again): nothing can be counted from it.
  if (at < 0) return 0;
  return messages.slice(at + 1).filter((message) => !memberId || message.member_id !== memberId).length;
}

/** The address with stage=1 on or off (lib/chatStageMode.ts has the same; that file carries the stock panel's code). */
function stageHref(href: string, on: boolean) {
  const url = new URL(href);
  if (on) url.searchParams.set("stage", "1");
  else url.searchParams.delete("stage");
  return url.toString();
}

/** The controls fade this long after the last touch, while the video is playing. */
const CHROME_MS = 4000;
/** This viewing room's own history entry, so the phone's back gesture returns to the room. */
const HISTORY_KEY = "chatStagePhone";
const marked = () => !!(window.history.state as Record<string, unknown> | null)?.[HISTORY_KEY];
let unmark: ReturnType<typeof setTimeout> | null = null;

const icon = { width: 22, height: 22, viewBox: "0 0 24 24", "aria-hidden": true } as const;
const line = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export default function StagePhone({
  room,
  roomLabel,
  admin,
  stageState,
  onStageRefresh,
  onExit,
  messages,
  memberId,
  roomUnread,
  onLatest,
}: {
  room: ChatRoom;
  roomLabel: string;
  /** A chat admin: may be here before the broadcast arrives (a member only while it is live); connects only once it is live (#512). */
  admin: boolean;
  /** The room's live video as the server last said. */
  stageState: StageState;
  onStageRefresh: () => void;
  onExit: () => void;
  /** The room's messages, for the count on the Chat button. */
  messages: readonly PublicChatMessage[];
  memberId: string | undefined;
  /** The room's unread messages as the bell counts them. */
  roomUnread: number;
  /** The room's own "Latest": the list goes to its newest message and follows new ones. */
  onLatest: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  // Browsers hold sound back until a tap: the room opens silent, with "Tap for sound".
  const [muted, setMuted] = useState(true);
  // The picture is there but not moving (a phone saving power, or back from the background).
  const [held, setHeld] = useState(false);
  const [canPip, setCanPip] = useState(false);
  const [pip, setPip] = useState(false);
  // The connection follows the same rule as the computer's player (lib/chatStageLink.ts, through
  // useStageLink.ts): held only while there is something to watch, let go 25 seconds after the
  // picture stops, and after 5 minutes in the background unless the sound is on or it is playing
  // picture-in-picture. Coming back to the page tries again.
  const { wanted, link, picture, viewers, audioBlocked, gone, startAudio, retry } = useStageLink({
    roomId: room,
    video: true,
    admin,
    stageState,
    onStageRefresh,
    videoRef,
    audioRef,
    volume: muted ? 0 : 1,
    listening: !muted,
    pip,
    resume: true,
  });
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (picture) setSeen(true);
    else if (stageState === "off") setSeen(false);
  }, [picture, stageState]);

  // #512: an admin waits here with no connection, exactly as a member would (the rule is the same
  // for everyone), so "gone" always means a broadcast that was live here stopped and did not return.
  const view = stagePhoneView({ state: stageState, link, picture, seen, gone });
  const live = view === "live";
  const soundOn = useCallback(() => {
    setMuted(false);
    startAudio();
  }, [startAudio]);
  const silent = muted || audioBlocked;

  // Whether the picture is actually moving. A phone may refuse to start it, or stop it in the background.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !wanted) return;
    const check = () => setHeld(el.paused && el.srcObject !== null);
    const entered = () => setPip(true);
    const left = () => setPip(false);
    for (const name of ["pause", "play", "playing", "loadeddata", "emptied"]) el.addEventListener(name, check);
    el.addEventListener("enterpictureinpicture", entered);
    el.addEventListener("leavepictureinpicture", left);
    return () => {
      for (const name of ["pause", "play", "playing", "loadeddata", "emptied"]) el.removeEventListener(name, check);
      el.removeEventListener("enterpictureinpicture", entered);
      el.removeEventListener("leavepictureinpicture", left);
      setHeld(false);
      setPip(false);
    };
  }, [wanted]);
  const play = useCallback(() => {
    void videoRef.current?.play().catch(() => undefined);
  }, []);
  // Back from another app or a locked screen: start a held picture again (useStageLink asks the
  // status again and reconnects).
  useEffect(() => {
    const back = () => {
      if (document.visibilityState === "visible" && videoRef.current?.paused && videoRef.current.srcObject) play();
    };
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [play]);

  // The address says the viewing room is open, on a history entry of its own: the phone's back
  // gesture (or button) then returns to the room instead of leaving it for the list.
  const exit = useRef(onExit);
  exit.current = onExit;
  useEffect(() => {
    if (unmark) clearTimeout(unmark);
    unmark = null;
    if (!marked())
      window.history.pushState(
        { ...(window.history.state as Record<string, unknown> | null), [HISTORY_KEY]: true },
        "",
        stageHref(window.location.href, true),
      );
    const popped = () => {
      if (!marked()) exit.current();
    };
    window.addEventListener("popstate", popped);
    return () => {
      window.removeEventListener("popstate", popped);
      // Closed some other way than back (the room itself was replaced): the entry stops saying "stage".
      // A moment later, so a development re-mount does not add a second entry.
      unmark = setTimeout(() => {
        unmark = null;
        if (!marked()) return;
        window.history.replaceState(
          { ...(window.history.state as Record<string, unknown> | null), [HISTORY_KEY]: undefined },
          "",
          stageHref(window.location.href, false),
        );
      }, 0);
    };
  }, []);
  const leave = useCallback(() => {
    if (marked()) window.history.back();
    else exit.current();
  }, []);

  // The room's chat, on the Chat button.
  const [chatOpen, setChatOpen] = useState(false);
  // The newest saved message (one still being sent changes its id when it is saved).
  const newest = messages.findLast((message) => !message.pending)?.id ?? null;
  // The newest message when the chat was last closed: what arrives after it is counted on the button.
  const [since, setSince] = useState<string | null>(newest);
  useEffect(() => {
    // An empty room's first message has nothing before it to count from: start at that message.
    if (!chatOpen && since === null && newest !== null) setSince(newest);
  }, [chatOpen, since, newest]);
  // A room following its newest message gets new ones into its list (and reads them as they come);
  // a room left part-way through its unread messages holds new ones back until it is scrolled, and
  // the bell's count for the room goes up instead. The button shows whichever has moved.
  const [unreadBase, setUnreadBase] = useState(roomUnread);
  useEffect(() => {
    // Read somewhere else meanwhile: count from the lower number.
    if (roomUnread < unreadBase) setUnreadBase(roomUnread);
  }, [roomUnread, unreadBase]);
  const unread = chatOpen ? 0 : Math.max(stagePhoneUnread(messages, since, memberId), roomUnread - unreadBase);
  const chatButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const openChat = () => {
    // During a broadcast it is a live chat: it opens on its newest message and follows new ones.
    onLatest();
    setChatOpen(true);
    requestAnimationFrame(() => closeButton.current?.focus({ preventScroll: true }));
  };
  const closeChat = () => {
    // The keyboard goes with the chat.
    if (document.activeElement instanceof HTMLElement && !rootRef.current?.contains(document.activeElement))
      document.activeElement.blur();
    setSince(newest);
    setUnreadBase(roomUnread);
    setChatOpen(false);
    requestAnimationFrame(() => chatButton.current?.focus({ preventScroll: true }));
  };

  // The controls: shown on arrival and on a tap, then they fade while the video plays.
  const [chrome, setChrome] = useState(true);
  const [touched, setTouched] = useState(0);
  const settled = live && !held && !chatOpen;
  useEffect(() => {
    if (!settled) {
      setChrome(true);
      return;
    }
    const timer = setTimeout(() => setChrome(false), CHROME_MS);
    return () => clearTimeout(timer);
  }, [settled, touched]);
  const wake = () => {
    setChrome(true);
    setTouched((n) => n + 1);
  };

  useEffect(() => {
    setCanPip(!!document.pictureInPictureEnabled && "requestPictureInPicture" in HTMLVideoElement.prototype);
  }, []);
  const togglePip = () => {
    const el = videoRef.current;
    if (!el) return;
    void (document.pictureInPictureElement ? document.exitPictureInPicture() : el.requestPictureInPicture()).catch(
      () => undefined,
    );
  };
  const toggleFull = () => {
    const area = screenRef.current;
    const el = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else if (area?.requestFullscreen) void area.requestFullscreen().catch(() => undefined);
    // An iPhone only lets the video itself go full screen.
    else el?.webkitEnterFullscreen?.();
  };

  // The room's own header (and its menus) is hidden: focus starts on this screen's back button.
  const backButton = useRef<HTMLButtonElement>(null);
  useEffect(() => backButton.current?.focus({ preventScroll: true }), []);

  const soundButton = (
    <button
      type="button"
      className={styles.iconButton}
      data-stage-phone-mute
      aria-label={silent ? "Turn sound on" : "Turn sound off"}
      aria-pressed={!silent}
      disabled={!live}
      onClick={() => (silent ? soundOn() : setMuted(true))}
    >
      <svg {...icon} {...line}>
        <path d="M4 9v6h4l5 4V5L8 9z" />
        {silent ? <path d="M17 9l5 6M22 9l-5 6" /> : <path d="M16.5 8.5a5 5 0 0 1 0 7" />}
      </svg>
    </button>
  );
  const identity = (
    <>
      {live && (
        <span className={styles.liveBadge} data-stage-live>
          <i aria-hidden="true" />
          LIVE
        </span>
      )}
      <strong className={styles.roomName}># {roomLabel}</strong>
      {live && viewers !== null && (
        <span className={styles.viewers} data-stage-viewers>
          {viewers} watching
        </span>
      )}
    </>
  );

  return (
    <div
      ref={rootRef}
      className={styles.root}
      data-stage-root={room}
      data-stage-phone
      data-stage-chat={chatOpen ? "open" : "closed"}
      data-stage-chrome={chrome ? "shown" : "hidden"}
      data-stage-video={room}
      data-stage-video-state={view}
      onFocus={wake}
    >
      <div ref={screenRef} className={styles.screen} data-stage-phone-screen onClick={() => (chrome && settled ? setChrome(false) : wake())}>
        {wanted && (
          <>
            {/* The picture. Its own sound is off: the sound plays through the audio element. */}
            <video ref={videoRef} className={styles.video} data-stage-video-feed autoPlay playsInline muted hidden={!live} />
            <audio ref={audioRef} autoPlay hidden />
          </>
        )}
        {!live && (
          <div className={styles.message} data-stage-video-message={view} role="status">
            <strong>
              {view === "ended"
                ? "The broadcast has ended"
                : view === "error"
                  ? "Couldn’t connect to the live video"
                  : view === "connecting"
                    ? "Connecting to the live video…"
                    : view === "stopped"
                      ? "The broadcast has stopped"
                      : "Waiting for the broadcast to start"}
            </strong>
            {view === "ended" ? (
              <button type="button" className={styles.action} data-stage-phone-ended-back onClick={leave}>
                Back to the room
              </button>
            ) : view === "error" ? (
              <button type="button" className={styles.action} data-stage-video-retry onClick={retry}>
                Try again
              </button>
            ) : view === "connecting" ? null : (
              <span>{view === "stopped" ? "If it comes back, it plays here by itself." : "The video starts here by itself."}</span>
            )}
          </div>
        )}
        {live && held && (
          <button
            type="button"
            className={styles.playButton}
            data-stage-phone-play
            aria-label="Play the live video"
            onClick={(event) => {
              event.stopPropagation();
              play();
            }}
          >
            <svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 5l12 7-12 7z" />
            </svg>
          </button>
        )}
      </div>

      {live && silent && (
        <button type="button" className={styles.soundPrompt} data-stage-sound onClick={soundOn}>
          <svg {...icon} {...line}>
            <path d="M4 9v6h4l5 4V5L8 9z" />
            <path d="M17 9l5 6M22 9l-5 6" />
          </svg>
          Tap for sound
        </button>
      )}

      <header className={styles.top} data-stage-phone-top>
        <button ref={backButton} type="button" className={styles.iconButton} data-stage-exit aria-label="Back to the room" onClick={leave}>
          <svg {...icon} {...line}>
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        {identity}
      </header>

      <div className={styles.bottom} data-stage-phone-bottom>
        {soundButton}
        {canPip && (
          <button type="button" className={styles.iconButton} aria-label="Picture in picture" disabled={!live} onClick={togglePip}>
            <svg {...icon} {...line}>
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <rect x="12" y="11" width="7" height="6" rx="1" fill="currentColor" />
            </svg>
          </button>
        )}
        <button type="button" className={styles.iconButton} aria-label="Full screen" disabled={!live} onClick={toggleFull}>
          <svg {...icon} {...line}>
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg>
        </button>
      </div>

      {!chatOpen && (
        <button
          ref={chatButton}
          type="button"
          className={styles.chatButton}
          data-stage-phone-chat
          aria-label={unread ? `Chat, ${unread} new ${unread === 1 ? "message" : "messages"}` : "Chat"}
          aria-expanded={false}
          onClick={openChat}
        >
          <svg {...icon} {...line}>
            <path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
          </svg>
          Chat
          {unread > 0 && (
            <span className={styles.unread} data-stage-phone-unread aria-hidden="true">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      )}

      {chatOpen && (
        <div className={styles.chatBar} data-stage-phone-chat-bar>
          <span className={styles.chatBarIdentity}>{identity}</span>
          {soundButton}
          <button
            ref={closeButton}
            type="button"
            className={styles.iconButton}
            data-stage-phone-chat-close
            aria-label="Close chat"
            onClick={closeChat}
          >
            <svg {...icon} {...line}>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
