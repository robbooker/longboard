"use client";
// #501/#502: the stage's video player. Everything video-specific lives in this one component.
// While the room is live it connects to LiveKit (stageFeed.ts, watch-only) and plays the broadcast;
// otherwise it holds no connection and says what it is waiting for. The overlay is its own
// layer on top of the video area, so events can drive it without touching the player.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ChatRoom } from "@/lib/publicChat";
import type { StageState } from "@/lib/chatStageLive";
import { useStageLink, type StageLink } from "./useStageLink";
import { STAGE_HOST } from "./stageSample";
import styles from "./StageMode.module.css";

const icon = { width: 18, height: 18, viewBox: "0 0 24 24", "aria-hidden": true } as const;
const line = { fill: "none", stroke: "currentColor", strokeWidth: 2 } as const;

/** What the player is showing. */
export type StagePlayerView = "preview" | "connecting" | "waiting" | "live" | "ended" | "error";
type Link = StageLink;

/** The one answer for what to show, from the room's status and this player's own connection. */
export function stagePlayerView(input: {
  /** Live video is set up on the server. */
  video: boolean;
  state: StageState;
  /** The room has had its stream key at some point while this player was open. */
  started: boolean;
  link: Link;
  /** The broadcast's picture is playing here. */
  picture: boolean;
  /** #511: this player let go of its connection because the broadcast stopped and did not come back. */
  gone?: boolean;
}): StagePlayerView {
  if (!input.video) return "preview";
  if (input.picture) return "live";
  if (input.state === "off" || input.link === "ended" || input.gone) return input.started ? "ended" : "preview";
  if (input.link === "failed") return "error";
  if (input.link === "connecting" && input.state === "live") return "connecting";
  return "waiting";
}

export default function StageVideo({
  roomId,
  roomLabel,
  admin,
  video,
  stageState,
  onStageRefresh,
  onFeed,
  overlay,
}: {
  roomId: ChatRoom;
  roomLabel: string;
  /** A chat admin: sees the sample host line, and tells the room when the broadcast arrives or drops. */
  admin: boolean;
  /** Live video is set up on the server. Off: always the placeholder. */
  video: boolean;
  stageState: StageState;
  /** Ask the server for the room's status again. */
  onStageRefresh: () => void;
  /** Whether the broadcast is playing here, and how many are watching (null when not known). */
  onFeed: (feed: { live: boolean; viewers: number | null }) => void;
  overlay?: ReactNode;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [height, setHeight] = useState(0);
  const [full, setFull] = useState(false);
  const [pip, setPip] = useState(false);
  const [canPip, setCanPip] = useState(false);
  // Set up at some point while this player was open: "off" after that means its key was taken away.
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (stageState !== "off") setStarted(true);
  }, [stageState]);
  // #511: connected only while there is something to watch. The rule is lib/chatStageLink.ts; the
  // wiring around it (shared with the phone's viewing room) is useStageLink.ts.
  const { wanted, link, picture, viewers, audioBlocked, gone, startAudio, retry } = useStageLink({
    roomId,
    video,
    admin,
    stageState,
    onStageRefresh,
    videoRef,
    audioRef,
    volume: muted || paused ? 0 : volume,
    listening: !paused && !muted && volume > 0,
    pip,
  });
  // The picture has played here: a later "waiting" is the broadcast having stopped, not yet to start.
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (picture) setSeen(true);
    else if (stageState === "off") setSeen(false);
  }, [picture, stageState]);

  const view = stagePlayerView({ video, state: stageState, started, link, picture, gone });
  const live = view === "live";
  const report = useRef(onFeed);
  report.current = onFeed;
  useEffect(() => report.current({ live, viewers: live ? viewers : null }), [live, viewers]);
  // An admin's player tells the room when the broadcast arrives or drops, so members' pages ask the
  // status again (their LIVE button appears or goes) without waiting for a room switch.
  // Only a change is told: arriving while the status still says "waiting", or dropping after playing.
  const told = useRef(false);
  useEffect(() => {
    if (!admin || !video || told.current === picture) return;
    told.current = picture;
    if (picture && stageState === "live") return;
    void fetch("/api/chat/stage/live", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: roomId, action: "refresh" }),
    }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the status is read as it stands when the picture changes
  }, [admin, video, picture, roomId]);

  // Sound: paused or muted is silence; otherwise the chosen volume.
  useEffect(() => {
    if (!live) setPaused(false);
  }, [live]);
  const togglePause = () => {
    const el = videoRef.current;
    if (!el) return;
    if (paused) void el.play().catch(() => undefined);
    else el.pause();
    setPaused(!paused);
  };
  const tapForSound = () => {
    setMuted(false);
    startAudio();
  };
  useEffect(() => {
    setCanPip(!!document.pictureInPictureEnabled && "requestPictureInPicture" in HTMLVideoElement.prototype);
    const el = videoRef.current;
    if (!el) return;
    const size = () => setHeight(el.videoHeight);
    const entered = () => setPip(true);
    const left = () => setPip(false);
    const screen = () => setFull(document.fullscreenElement === areaRef.current);
    el.addEventListener("resize", size);
    el.addEventListener("loadedmetadata", size);
    el.addEventListener("enterpictureinpicture", entered);
    el.addEventListener("leavepictureinpicture", left);
    document.addEventListener("fullscreenchange", screen);
    return () => {
      el.removeEventListener("resize", size);
      el.removeEventListener("loadedmetadata", size);
      el.removeEventListener("enterpictureinpicture", entered);
      el.removeEventListener("leavepictureinpicture", left);
      document.removeEventListener("fullscreenchange", screen);
    };
  }, [wanted]);
  const togglePip = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    void (document.pictureInPictureElement ? document.exitPictureInPicture() : el.requestPictureInPicture()).catch(
      () => undefined,
    );
  }, []);
  const toggleFull = useCallback(() => {
    const area = areaRef.current;
    const el = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else if (area?.requestFullscreen) void area.requestFullscreen().catch(() => undefined);
    // An iPhone only lets the video itself go full screen.
    else el?.webkitEnterFullscreen?.();
  }, []);

  const silent = muted || volume === 0;
  return (
    <div className={styles.player} data-stage-video={roomId} data-stage-video-state={view} data-live={live || undefined}>
      <div className={styles.playerBar}>
        <span className={styles.liveVideoBadge} data-off={!(live || view === "preview") || undefined}>
          <i aria-hidden="true" />
          {live || view === "preview" ? "LIVE VIDEO" : "VIDEO"}
        </span>
        {admin ? (
          <>
            <span className={styles.hostAvatar} aria-hidden="true">
              {STAGE_HOST.initials}
            </span>
            <strong className={styles.hostName}>{STAGE_HOST.name}</strong>
            <span className={`${styles.secondary} ${styles.hostTopic}`} data-stage-host-sample>
              on stage · {STAGE_HOST.topic} <small>(sample)</small>
            </span>
          </>
        ) : (
          <strong className={styles.hostName}># {roomLabel}</strong>
        )}
        <span className={styles.spacer} />
        {view === "preview" ? (
          <span className={`${styles.mono} ${styles.secondary}`}>{video ? "not set up" : "sample video"}</span>
        ) : link === "reconnecting" ? (
          <span className={`${styles.mono} ${styles.secondary}`} role="status">
            Reconnecting…
          </span>
        ) : null}
      </div>
      <div ref={areaRef} className={styles.videoArea} data-stage-video-area>
        {wanted && (
          <>
            {/* The picture. Its own sound is off: the sound plays through the audio element. */}
            <video ref={videoRef} className={styles.video} data-stage-video-feed autoPlay playsInline muted hidden={!live} />
            <audio ref={audioRef} autoPlay hidden />
          </>
        )}
        {view === "preview" ? (
          <div className={styles.videoPlaceholder} data-stage-video-placeholder>
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <rect x="2.5" y="6" width="13" height="12" rx="2.5" />
              <path d="M15.5 10.5l6-3.5v10l-6-3.5" />
            </svg>
            <span className={styles.videoTitle}>[Live video feed]</span>
            <span className={styles.secondary}>
              {video ? "Broadcast from StreamYard with the stream address and key below" : "Rob’s camera and screen share play here"}
            </span>
          </div>
        ) : !live ? (
          <div className={styles.videoPlaceholder} data-stage-video-message={view} role="status">
            <span className={styles.videoTitle}>
              {view === "ended"
                ? "The broadcast has ended"
                : view === "error"
                  ? "Couldn’t connect to the live video"
                  : view === "connecting"
                    ? "Connecting to the live video…"
                    : seen
                      ? "The broadcast has stopped"
                      : "Waiting for the broadcast to start"}
            </span>
            {view === "error" ? (
              <button type="button" className={styles.videoAction} data-stage-video-retry onClick={retry}>
                Try again
              </button>
            ) : view === "waiting" ? (
              <span className={styles.secondary}>
                {seen ? "If it comes back, it plays here by itself." : "The video starts here by itself."}
              </span>
            ) : null}
          </div>
        ) : null}
        {live && audioBlocked && (
          <button type="button" className={styles.soundPrompt} data-stage-sound onClick={tapForSound}>
            <svg {...icon} {...line}>
              <path d="M4 9v6h4l5 4V5L8 9z" />
              <path d="M17 9l5 6M22 9l-5 6" />
            </svg>
            Tap for sound
          </button>
        )}
        {/* The overlay layer, above whatever the video area draws. */}
        <div className={styles.overlayLayer} data-stage-overlay>
          {overlay}
        </div>
      </div>
      <div className={styles.playerControls}>
        <button type="button" className={styles.playerButton} aria-label={paused ? "Play" : "Pause"} disabled={!live} onClick={togglePause}>
          {paused ? (
            <svg {...icon} fill="currentColor">
              <path d="M7 5l12 7-12 7z" />
            </svg>
          ) : (
            <svg {...icon} fill="currentColor">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className={styles.playerButton}
          aria-label={silent ? "Unmute" : "Mute"}
          aria-pressed={silent}
          disabled={!live}
          onClick={() => {
            if (silent) {
              if (volume === 0) setVolume(1);
              tapForSound();
            } else setMuted(true);
          }}
        >
          <svg {...icon} {...line}>
            <path d="M4 9v6h4l5 4V5L8 9z" />
            {silent ? <path d="M17 9l5 6M22 9l-5 6" /> : <path d="M16.5 8.5a5 5 0 0 1 0 7" />}
          </svg>
        </button>
        <input
          type="range"
          className={styles.volume}
          aria-label="Volume"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          disabled={!live}
          onChange={(event) => {
            const next = Number(event.target.value);
            setVolume(next);
            setMuted(next === 0);
          }}
        />
        <div className={styles.scrub} role="img" aria-label={live ? (paused ? "Paused" : "Playing live") : "Not playing"} data-off={!live || paused || undefined}>
          <span className={styles.scrubFill} />
          <span className={styles.scrubKnob} />
        </div>
        {live && <span className={`${styles.mono} ${styles.scrubLive}`}>{paused ? "PAUSED" : "LIVE"}</span>}
        {live && height > 0 && (
          <span className={`${styles.mono} ${styles.playerQuality}`} data-stage-video-quality title="Picture size being shown">
            {height}p
          </span>
        )}
        {canPip && (
          <button type="button" className={styles.playerButton} aria-label="Picture in picture" aria-pressed={pip} disabled={!live} onClick={togglePip}>
            <svg {...icon} {...line}>
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <rect x="12" y="11" width="7" height="6" rx="1" fill="currentColor" />
            </svg>
          </button>
        )}
        <button type="button" className={styles.playerButton} aria-label={full ? "Leave full screen" : "Full screen"} disabled={!live} onClick={toggleFull}>
          <svg {...icon} {...line}>
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
