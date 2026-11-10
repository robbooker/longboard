"use client";
import { useEffect, useState } from "react";
import type { RadioState } from "@/lib/chatRadioPlayer";
import { radioVolumeAdjustable, useChatRadio } from "./room/useChatRadio";
import styles from "./ChatRadio.module.css";

/** What the Gainers control says next to its pause button. */
export function radioStatus(state: RadioState) {
  if (state.note) return state.note;
  if (state.phase === "starting") return "Starting Trader Radio…";
  if (state.phase === "playing") return `Playing ${state.label ?? "a squawk"}`;
  if (state.phase === "quiet") return "No squawks right now";
  return "Listening for the next squawk";
}

/**
 * #415 Trader Radio. With `room` it is the Gainers control: a play button that turns into pause,
 * what is playing, and volume. Without it, it is the small "Trader Radio playing" marker shown
 * everywhere else, and only while the radio is on. Every copy drives the page's one player.
 *
 * `shape`: "header" for the single chat's header, "pane" for a Quad or Six panel header (no room
 * for words), "bar" for the strip under a phone's header, "pill" for toolbars.
 */
export default function ChatRadio({
  room = false,
  shape,
}: {
  room?: boolean;
  shape: "header" | "pane" | "bar" | "pill";
}) {
  const { state, start, stop, setVolume } = useChatRadio();
  const [slider, setSlider] = useState(false);
  useEffect(() => setSlider(radioVolumeAdjustable()), []);
  if (!state.on && !room) return null;
  const words = room ? radioStatus(state) : "Trader Radio playing";
  const worded = state.on || !!state.note;
  return (
    <div
      className={styles.radio}
      data-shape={shape}
      data-on={state.on}
      data-words={worded}
      role="group"
      aria-label="Trader Radio"
    >
      {state.on ? (
        <button
          type="button"
          className={styles.button}
          aria-label="Pause Trader Radio"
          title="Pause Trader Radio"
          onClick={stop}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <rect x="2" y="1.5" width="3.5" height="11" rx="1" fill="currentColor" />
            <rect x="8.5" y="1.5" width="3.5" height="11" rx="1" fill="currentColor" />
          </svg>
        </button>
      ) : (
        <button
          type="button"
          className={styles.button}
          aria-label="Play Trader Radio"
          title="Play Trader Radio"
          onClick={start}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path
              d="M3 1.6v10.8a.6.6 0 0 0 .9.5l8.6-5.4a.6.6 0 0 0 0-1L3.9 1.1a.6.6 0 0 0-.9.5Z"
              fill="currentColor"
            />
          </svg>
          <span className={styles.name}>Trader Radio</span>
        </button>
      )}
      {worded && (
        <span className={styles.words} title={words} role="status">
          {state.on && <i aria-hidden="true" data-playing={state.phase === "playing"} />}
          <span>{words}</span>
        </span>
      )}
      {state.on && room && slider && (
        <input
          className={styles.volume}
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={state.volume}
          aria-label="Trader Radio volume"
          title="Volume"
          onChange={(event) => setVolume(Number(event.target.value))}
        />
      )}
    </div>
  );
}
