"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { RecordingVideo } from "@/lib/chatRecordingVideos";
import styles from "./ChatRecordingVideos.module.css";

// One video plays at a time: pressing play on another card puts the last one back to its still card.
let stopPlaying: (() => void) | null = null;

/**
 * #513: a recording's player card. Until the member presses play it is only our own still card:
 * nothing is asked of YouTube or Loom when the room opens. The player then fills the same box.
 * #529: Booker Tube uses the same card. `children` replaces what the still card shows (its own
 * picture and play mark), `fill` fits the card to its box, `playRequest`/`stopRequest` start or
 * stop it from outside (a higher number each time), and `onPlayingChange` says when it changes.
 */
export function RecordingVideoCard({
  video,
  fill,
  children,
  playRequest = 0,
  stopRequest = 0,
  onPlayingChange,
}: {
  video: RecordingVideo;
  fill?: boolean;
  children?: ReactNode;
  playRequest?: number;
  stopRequest?: number;
  onPlayingChange?: (playing: boolean) => void;
}) {
  const [playing, setPlaying] = useState(false);
  const requests = useRef({ play: playRequest, stop: stopRequest, playing: false, changed: onPlayingChange });
  requests.current.changed = onPlayingChange;
  useEffect(() => {
    const seen = requests.current;
    if (playRequest !== seen.play) setPlaying(true);
    else if (stopRequest !== seen.stop) setPlaying(false);
    seen.play = playRequest;
    seen.stop = stopRequest;
  }, [playRequest, stopRequest]);
  useEffect(() => {
    const seen = requests.current;
    if (seen.playing !== playing) seen.changed?.(playing);
    seen.playing = playing;
  }, [playing]);
  useEffect(() => {
    if (!playing) return;
    const stop = () => setPlaying(false);
    stopPlaying?.();
    stopPlaying = stop;
    return () => {
      if (stopPlaying === stop) stopPlaying = null;
    };
  }, [playing]);
  const name = video.title ? `${video.label}: ${video.title}` : video.label;
  return (
    <div
      className={styles.card}
      data-recording-video={video.kind}
      data-playing={playing || undefined}
      data-fill={fill || undefined}
    >
      {playing ? (
        <iframe
          className={styles.frame}
          src={video.embedUrl}
          title={name}
          allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
          allowFullScreen
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
        />
      ) : (
        <button
          type="button"
          className={styles.still}
          onClick={() => setPlaying(true)}
          aria-label={`Play ${name}`}
        >
          {children ?? (
            <>
              <span className={styles.play} aria-hidden="true" />
              <span className={styles.caption}>
                <span className={styles.label}>{video.label}</span>
                {video.title ? <span className={styles.title}>{video.title}</span> : null}
              </span>
            </>
          )}
        </button>
      )}
    </div>
  );
}

export default function ChatRecordingVideos({ videos }: { videos: RecordingVideo[] }) {
  return (
    <div className={styles.list}>
      {videos.map((video) => (
        <RecordingVideoCard key={`${video.kind}-${video.id}`} video={video} />
      ))}
    </div>
  );
}
