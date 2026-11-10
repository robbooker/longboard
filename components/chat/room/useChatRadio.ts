"use client";
import { RADIO_STALL_MS, type RadioEvent } from "@/lib/chatRadio";
import { createChatRadio, RADIO_OFF, type RadioClipResult } from "@/lib/chatRadioPlayer";
import { useSyncExternalStore } from "react";

/**
 * #415 Trader Radio: the browser half of the player (lib/chatRadioPlayer.ts has the rules). One
 * audio element and one player per page, created here at module level so the single chat, Quad and
 * Six, and every panel inside them, share it: there is nothing to play twice.
 */

const VOLUME_KEY = "longboard:chat-radio-volume";
/** A clip is downloaded whole before it plays; a download slower than this is skipped. */
const DOWNLOAD_MS = 60_000;

let audio: HTMLAudioElement | null = null;
/** Settles the clip in flight; null when nothing is playing. */
let finish: ((result: RadioClipResult) => void) | null = null;
/** True once the audio element holds the clip (not the silent unlock sound). */
let armed = false;
let download: AbortController | null = null;
let clipUrl: string | null = null;
let stall: number | undefined;
let silentUrl: string | null = null;
let channel: BroadcastChannel | null = null;

function settle(result: RadioClipResult) {
  const done = finish;
  finish = null;
  armed = false;
  window.clearTimeout(stall);
  download?.abort();
  download = null;
  done?.(result);
}
function watch(ms: number) {
  window.clearTimeout(stall);
  stall = window.setTimeout(() => settle("failed"), ms);
}
function release() {
  if (clipUrl) URL.revokeObjectURL(clipUrl);
  clipUrl = null;
}
function element() {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = "auto";
  audio.setAttribute("playsinline", "");
  audio.addEventListener("ended", () => armed && settle("ended"));
  audio.addEventListener("error", () => armed && settle("failed"));
  audio.addEventListener("timeupdate", () => armed && watch(RADIO_STALL_MS));
  return audio;
}
/** A twentieth of a second of silence, built here so nothing is fetched before the member taps. */
function silence() {
  if (silentUrl) return silentUrl;
  const samples = 400;
  const wav = new DataView(new ArrayBuffer(44 + samples));
  const ascii = (at: number, word: string) =>
    [...word].forEach((letter, i) => wav.setUint8(at + i, letter.charCodeAt(0)));
  ascii(0, "RIFF");
  wav.setUint32(4, 36 + samples, true);
  ascii(8, "WAVEfmt ");
  wav.setUint32(16, 16, true);
  wav.setUint16(20, 1, true);
  wav.setUint16(22, 1, true);
  wav.setUint32(24, 8000, true);
  wav.setUint32(28, 8000, true);
  wav.setUint16(32, 1, true);
  wav.setUint16(34, 8, true);
  ascii(36, "data");
  wav.setUint32(40, samples, true);
  for (let i = 0; i < samples; i += 1) wav.setUint8(44 + i, 128);
  silentUrl = URL.createObjectURL(new Blob([wav.buffer], { type: "audio/wav" }));
  return silentUrl;
}

function play(event: RadioEvent) {
  settle("stopped");
  const el = element();
  return new Promise<RadioClipResult>((resolve) => {
    finish = resolve;
    const current = (download = new AbortController());
    watch(DOWNLOAD_MS);
    // Fetched whole and without a Range header, so the CDN's copy (and then the browser's) answers
    // it; an <audio src> asks in ranges, which the CDN never keeps. No cookies: nothing needs them.
    fetch(event.audioUrl, { credentials: "omit", signal: current.signal })
      .then((response) => {
        if (!response.ok) throw new Error("clip");
        return response.blob();
      })
      .then((blob) => {
        if (download !== current) return;
        release();
        clipUrl = URL.createObjectURL(blob);
        el.src = clipUrl;
        armed = true;
        watch(RADIO_STALL_MS);
        return el.play();
      })
      .catch((error: unknown) => {
        if (download !== current) return;
        settle(error instanceof DOMException && error.name === "NotAllowedError" ? "blocked" : "failed");
      });
  });
}

const radio = createChatRadio({
  now: () => Date.now(),
  wait: (ms, run) => {
    const timer = window.setTimeout(run, ms);
    return () => window.clearTimeout(timer);
  },
  getJson: async (url) => {
    // The listening key is the only request that needs the member's sign-in.
    const own = url.startsWith("/api/chat/radio/listen");
    const response = await fetch(url, { cache: "no-store", credentials: own ? "same-origin" : "omit" });
    return { status: response.status, body: await response.json().catch(() => null) };
  },
  unlock: () => {
    const el = element();
    el.src = silence();
    el.play().catch(() => {});
  },
  play,
  silence: () => {
    settle("stopped");
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    release();
  },
  setVolume: (volume) => {
    if (!audio) return;
    audio.volume = volume;
    audio.muted = volume === 0;
  },
  loadVolume: () => {
    try {
      const saved = window.localStorage.getItem(VOLUME_KEY);
      return saved === null ? null : Number(saved);
    } catch {
      return null;
    }
  },
  saveVolume: (volume) => {
    try {
      window.localStorage.setItem(VOLUME_KEY, String(volume));
    } catch {}
  },
  // One radio per member, not per window: starting here pauses the Gainers pop-out or another tab.
  announce: () => {
    try {
      if (!channel) {
        channel = new BroadcastChannel("longboard-chat-radio");
        channel.onmessage = () =>
          radio.get().on && radio.stop("Trader Radio is playing in your other window.");
      }
      channel.postMessage("playing");
    } catch {}
  },
});

/** Lock-screen and headset controls: what is on, and a working pause. */
function mediaSession() {
  try {
    const session = navigator.mediaSession;
    const state = radio.get();
    session.metadata = state.on
      ? new MediaMetadata({ title: state.label ?? "Trader Radio", artist: "Trader Radio" })
      : null;
    session.playbackState = state.on ? "playing" : "none";
    session.setActionHandler("pause", state.on ? () => radio.stop() : null);
  } catch {}
}
if (typeof window !== "undefined") radio.subscribe(mediaSession);

/** iPhones set the volume with the side buttons only; there the slider is left out. */
export function radioVolumeAdjustable() {
  try {
    const probe = new Audio();
    probe.volume = 0.5;
    return probe.volume === 0.5;
  } catch {
    return false;
  }
}

const serverState = () => RADIO_OFF;
export function useChatRadio() {
  const state = useSyncExternalStore(radio.subscribe, radio.get, serverState);
  return { state, start: radio.start, stop: () => radio.stop(), setVolume: radio.setVolume };
}
