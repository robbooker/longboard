"use client";
// #509 Stage mode on a phone: the viewing room. A dark full screen with only the live video and a
// few controls (back, the room's name, LIVE, who is watching, sound, full screen, Chat).
// "Chat" brings in the room's REAL chat: PublicChat keeps its message list, composer, outbox and
// typing indicator mounted where they are, and StagePhone.module.css lays that section out
//  - upright: under the video, which docks to the top of the screen;
//  - on its side: as a see-through panel over the right half of the video.
// Closing it gives the whole screen back to the video. Turning the phone only changes the styles:
// the video element and its connection stay as they are.
// #527: Raise hand is here too, with the computer's own logic (useStageHand.ts, StageHands.tsx):
//  - a Raise hand / Lower hand button with the controls; while your hand is up it stays on screen
//    after the controls fade, as a "Hand up" chip (a tap on the chip brings the controls back; it
//    lowers only once they are showing, so a stray touch never takes your place in the queue);
//  - "N hands up" beside it opens the list (admins: Lower and Lower all) as a sheet that leaves the
//    picture alone: upright over the chat (or the bottom third when the chat is closed), on its side
//    in the right half the chat uses;
//  - what went wrong is said in a short line near the button, read out, and goes by itself.
// Nothing else from the computer's stage is here (no stock panel, trades, questions, chapters or
// broadcast controls). Downloaded only when someone opens it; livekit-client comes later still,
// when the connection is made (stageFeed.ts).
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ChatRoom, PublicChatMessage } from "@/lib/publicChat";
import type { StageState } from "@/lib/chatStageLive";
import { stageHandCountLabel } from "@/lib/chatStageHand";
import StageHands from "./StageHands";
import { useStageHand } from "./useStageHand";
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
  if (input.link === "failed" || input.link === "replaced") return "error";
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
/** What went wrong with a hand stays on screen this long. */
const HAND_NOTE_MS = 6000;
/** A touch on the faded "Hand up" chip brings the controls back; the click that follows within this long does not lower the hand. */
const CHIP_WAKE_MS = 1000;
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
    // #522: a phone asks for the member's second seat, so it and a computer's stage never pick the same one.
    seat: 2,
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
  // #527: raising a hand, and the list of who has one up (the computer stage's own hook).
  const hand = useStageHand(room);
  const [handsOpen, setHandsOpen] = useState(false);
  const handsId = useId();
  const handsClose = useRef<HTMLButtonElement>(null);
  // The connection went (the broadcast ended, or it failed): its hands went with it.
  useEffect(() => {
    if (!hand.connected) setHandsOpen(false);
  }, [hand.connected]);
  /** The keyboard goes when something else takes the composer's place. */
  const dropKeyboard = () => {
    if (document.activeElement instanceof HTMLElement && !rootRef.current?.contains(document.activeElement))
      document.activeElement.blur();
  };
  /** After the list closes: focus goes to whichever of the count and the hand button is on screen. */
  const focusHandControl = () =>
    requestAnimationFrame(() => {
      const onScreen = (selector: string) =>
        [...(rootRef.current?.querySelectorAll<HTMLElement>(selector) ?? [])].find((el) => el.offsetParent !== null);
      (onScreen("[data-stage-hands-toggle]") ?? onScreen("[data-stage-hand]"))?.focus({ preventScroll: true });
    });
  const openHands = () => {
    // The list takes the chat's place: the composer lets go of the keyboard, and of the focus.
    dropKeyboard();
    setHandsOpen(true);
    requestAnimationFrame(() => handsClose.current?.focus({ preventScroll: true }));
  };
  const closeHands = () => {
    setHandsOpen(false);
    focusHandControl();
  };
  const openChat = () => {
    // During a broadcast it is a live chat: it opens on its newest message and follows new ones.
    onLatest();
    setHandsOpen(false);
    setChatOpen(true);
    requestAnimationFrame(() => closeButton.current?.focus({ preventScroll: true }));
  };
  const closeChat = () => {
    // The keyboard goes with the chat.
    dropKeyboard();
    setHandsOpen(false);
    setSince(newest);
    setUnreadBase(roomUnread);
    setChatOpen(false);
    requestAnimationFrame(() => chatButton.current?.focus({ preventScroll: true }));
  };

  // #527: what went wrong with a hand, in a line near the button. It is read out (the line is a
  // live region), goes by itself, and keeps the controls on screen while it is there.
  const [handNote, setHandNote] = useState("");
  const [handNoted, setHandNoted] = useState(0);
  const sayHand = useCallback((text: string) => {
    setHandNote(text);
    setHandNoted((n) => n + 1);
  }, []);
  useEffect(() => sayHand(hand.error), [hand.error, sayHand]);
  useEffect(() => {
    if (!handNote) return;
    const timer = setTimeout(() => setHandNote(""), HAND_NOTE_MS);
    return () => clearTimeout(timer);
  }, [handNote, handNoted]);

  // The controls: shown on arrival and on a tap, then they fade while the video plays.
  const [chrome, setChrome] = useState(true);
  const [touched, setTouched] = useState(0);
  const settled = live && !held && !chatOpen && !handsOpen && !handNote;
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

  // When the faded chip was last touched.
  const chipWoken = useRef(0);
  const pressHand = () => {
    if (performance.now() - chipWoken.current < CHIP_WAKE_MS) {
      chipWoken.current = 0;
      return wake();
    }
    // The server says the same (it is asked only while the picture is playing); a hand that is
    // already up can still be lowered.
    if (!hand.raised && !live) return sayHand("You can raise a hand once the live video is playing.");
    hand.toggle();
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
  // #527: the hand button. Over the video it says what it does; on the strip above the chat it is
  // the icon alone, filled while the hand is up.
  const handControl = (place: "video" | "bar") =>
    hand.connected && (
      <button
        type="button"
        className={place === "bar" ? `${styles.iconButton} ${styles.handToggle}` : styles.handButton}
        data-stage-hand={hand.raised ? "up" : "down"}
        aria-pressed={hand.raised}
        aria-busy={hand.busy || undefined}
        aria-label={place === "bar" ? (hand.raised ? "Lower hand" : "Raise hand") : undefined}
        onPointerDown={() => {
          chipWoken.current = chrome ? 0 : performance.now();
        }}
        onClick={pressHand}
      >
        <svg {...icon} {...line}>
          <path d="M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8" />
          <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
        </svg>
        {place === "video" && (hand.raised ? (chrome ? "Lower hand" : "Hand up") : "Raise hand")}
      </button>
    );
  const handsCount = (place: "video" | "bar") =>
    hand.connected &&
    hand.count > 0 && (
      <button
        type="button"
        className={place === "bar" ? styles.handsCountBar : styles.handsCount}
        data-stage-hands-toggle
        data-stage-hand-count={hand.count}
        aria-expanded={handsOpen}
        aria-controls={handsOpen ? handsId : undefined}
        onClick={handsOpen ? closeHands : openHands}
      >
        {stageHandCountLabel(hand.count)}
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
      data-stage-hands={handsOpen ? "open" : "closed"}
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
                  ? link === "replaced"
                    ? "The live video is playing on two of your other screens"
                    : "Couldn’t connect to the live video"
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
                {link === "replaced" ? "Watch here instead" : "Try again"}
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

      {/* The corner of the screen: the hand button and the count of hands, and under them Chat. */}
      <div className={styles.corner} data-stage-phone-corner>
        {hand.connected && (
          <div className={styles.handRow}>
            {handsCount("video")}
            {handControl("video")}
          </div>
        )}
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
      </div>
      <p className={styles.handNote} role="status" aria-live="polite" data-stage-hand-error>
        {handNote}
      </p>

      {chatOpen && (
        <div className={styles.chatBar} data-stage-phone-chat-bar>
          <span className={styles.chatBarIdentity}>{identity}</span>
          {handsCount("bar")}
          {handControl("bar")}
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

      {handsOpen && (
        <div
          id={handsId}
          className={styles.sheet}
          data-stage-hands-sheet
          onKeyDown={(event) => {
            if (event.key === "Escape") closeHands();
          }}
        >
          <button ref={handsClose} type="button" className={styles.sheetClose} data-stage-hands-close onClick={closeHands}>
            {chatOpen ? "Back to chat" : "Close"}
          </button>
          {/* What went wrong is said in the line near the hand button, for an admin's Lower too. */}
          <StageHands
            hands={hand.hands}
            busy={admin && hand.busy}
            error=""
            onLower={admin ? hand.lower : undefined}
            onLowerAll={admin ? hand.lowerAll : undefined}
          />
        </div>
      )}
    </div>
  );
}
