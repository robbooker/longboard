"use client";
import { useEffect, useState } from "react";
import type { RecordingVideo } from "@/lib/chatRecordingVideos";
import styles from "./ChatRecordingVideos.module.css";

// One video plays at a time: pressing play on another card puts the last one back to its still card.
let stopPlaying: (() => void) | null = null;

/**
 * #513: a recording's player card. Until the member presses play it is only our own still card:
 * nothing is asked of YouTube or Loom when the room opens. The player then fills the same box.
 */
function RecordingVideoCard({ video }: { video: RecordingVideo }) {
  const [playing, setPlaying] = useState(false);
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
    <div className={styles.card} data-recording-video={video.kind} data-playing={playing || undefined}>
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
        <button type="button" className={styles.still} onClick={() => setPlaying(true)} aria-label={`Play ${name}`}>
          <span className={styles.play} aria-hidden="true" />
          <span className={styles.caption}>
            <span className={styles.label}>{video.label}</span>
            {video.title ? <span className={styles.title}>{video.title}</span> : null}
          </span>
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
