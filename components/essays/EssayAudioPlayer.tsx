"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";

type Props = {
  src: string;
};

/** M:SS for segments under an hour; MM:SS for longer. Returns "—:—"
 *  while duration is still NaN (before loadedmetadata fires). */
function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—:—";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Inline audio player tailored to the editorial aesthetic. Renders a
 *  hairline-bracketed row with a moss play/pause square, a scrub bar
 *  that click-seeks, and mono time readout. Hidden <audio> element
 *  drives playback — `preload="metadata"` so the duration populates
 *  without pulling the whole file. */
export default function EssayAudioPlayer({ src }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState<number>(NaN);

  // Wire the audio element's events to component state. Using refs
  // keeps this side-effect-free across re-renders and avoids React
  // re-attaching handlers every tick as currentTime updates.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => setCurrentTime(el.currentTime);
    const onMeta = () => setDuration(el.duration);
    const onEnd = () => {
      setPlaying(false);
      setCurrentTime(0);
    };
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("ended", onEnd);
    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("ended", onEnd);
    };
  }, []);

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      // `play()` returns a Promise. Safari rejects if called without a
      // user gesture; we're inside a click handler so the gesture is
      // present. Swallow any rejection so it doesn't surface as an
      // unhandled promise.
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  };

  const seekFromClick = (e: MouseEvent<HTMLDivElement>) => {
    const el = audioRef.current;
    const bar = barRef.current;
    if (!el || !bar || !Number.isFinite(duration)) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    el.currentTime = ratio * duration;
    setCurrentTime(el.currentTime);
  };

  const progress = Number.isFinite(duration) && duration > 0 ? currentTime / duration : 0;

  return (
    <div className="essay-audio">
      <audio ref={audioRef} src={src} preload="metadata" />

      <button
        type="button"
        onClick={togglePlay}
        aria-label={playing ? "Pause" : "Play"}
        className="essay-audio-play"
      >
        {playing ? (
          // Two vertical pause bars.
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <rect x="2" y="1" width="3" height="12" fill="#f3e8d2" />
            <rect x="9" y="1" width="3" height="12" fill="#f3e8d2" />
          </svg>
        ) : (
          // Play triangle — offset 1px right for optical balance.
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M3 1 L12 7 L3 13 Z" fill="#f3e8d2" />
          </svg>
        )}
      </button>

      <div
        ref={barRef}
        role="slider"
        tabIndex={0}
        aria-valuemin={0}
        aria-valuemax={Number.isFinite(duration) ? Math.floor(duration) : 0}
        aria-valuenow={Math.floor(currentTime)}
        aria-label="Seek audio"
        onClick={seekFromClick}
        className="essay-audio-bar"
      >
        <div className="essay-audio-bar-fill" style={{ width: `${progress * 100}%` }} />
      </div>

      <div className="essay-audio-time">
        {formatTime(currentTime)} / {formatTime(duration)}
      </div>
    </div>
  );
}
