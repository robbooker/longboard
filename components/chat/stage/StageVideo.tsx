"use client";
// #501: the stage's video player. Everything video-specific lives in this one component: today it
// draws a placeholder; LiveKit (fed from StreamYard) is dropped in here later, keyed by the room id.
// The overlay is its own layer on top of the video area, so events can drive it without touching
// the player.
import type { ReactNode } from "react";
import type { ChatRoom } from "@/lib/publicChat";
import { STAGE_HOST } from "./stageSample";
import styles from "./StageMode.module.css";

/** The card in the video's bottom-left corner. Static for now; later set by a realtime event. */
export function StageOverlayCard({ tag, sym, note }: { tag: string; sym: string; note: string }) {
  return (
    <div className={`${styles.overlayCard} ${styles.mono}`} data-stage-overlay-card>
      <span className={styles.overlayTag}>{tag}</span>
      <strong>{sym}</strong>
      <span className={styles.secondary}>{note}</span>
    </div>
  );
}

const icon = { width: 18, height: 18, viewBox: "0 0 24 24", "aria-hidden": true } as const;
const line = { fill: "none", stroke: "currentColor", strokeWidth: 2 } as const;

export default function StageVideo({ roomId, overlay }: { roomId: ChatRoom; overlay?: ReactNode }) {
  return (
    <div className={styles.player} data-stage-video={roomId}>
      <div className={styles.playerBar}>
        <span className={styles.liveVideoBadge}>
          <i aria-hidden="true" />
          LIVE VIDEO
        </span>
        <span className={styles.hostAvatar} aria-hidden="true">
          {STAGE_HOST.initials}
        </span>
        <strong className={styles.hostName}>{STAGE_HOST.name}</strong>
        <span className={`${styles.secondary} ${styles.hostTopic}`}>on stage · {STAGE_HOST.topic}</span>
        <span className={styles.spacer} />
        <span className={`${styles.mono} ${styles.secondary}`}>under 1s delay</span>
      </div>
      <div className={styles.videoArea}>
        {/* The video itself: a placeholder until LiveKit is wired in. */}
        <div className={styles.videoPlaceholder} data-stage-video-placeholder>
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <rect x="2.5" y="6" width="13" height="12" rx="2.5" />
            <path d="M15.5 10.5l6-3.5v10l-6-3.5" />
          </svg>
          <span className={styles.videoTitle}>[Live video feed]</span>
          <span className={styles.secondary}>Rob’s camera and screen share play here</span>
        </div>
        {/* The overlay layer, above whatever the video area draws. */}
        {overlay ? (
          <div className={styles.overlayLayer} data-stage-overlay>
            {overlay}
          </div>
        ) : null}
      </div>
      <div className={styles.playerControls}>
        <button type="button" className={styles.playerButton} aria-label="Pause">
          <svg {...icon} fill="currentColor">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        </button>
        <button type="button" className={styles.playerButton} aria-label="Volume">
          <svg {...icon} {...line}>
            <path d="M4 9v6h4l5 4V5L8 9z" />
            <path d="M16.5 8.5a5 5 0 0 1 0 7" />
          </svg>
        </button>
        <div className={styles.scrub} role="img" aria-label="Playing live">
          <span className={styles.scrubFill} />
          <span className={styles.scrubKnob} />
        </div>
        <span className={`${styles.mono} ${styles.scrubLive}`}>LIVE</span>
        <button type="button" className={`${styles.playerButton} ${styles.playerQuality}`} aria-label="Quality: 720p">
          720p
        </button>
        <button type="button" className={styles.playerButton} aria-label="Picture in picture">
          <svg {...icon} {...line}>
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <rect x="12" y="11" width="7" height="6" rx="1" fill="currentColor" />
          </svg>
        </button>
        <button type="button" className={styles.playerButton} aria-label="Full screen">
          <svg {...icon} {...line}>
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
