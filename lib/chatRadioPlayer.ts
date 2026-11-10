import {
  RADIO_GAP_MS,
  RADIO_POLL_MS,
  radioEventLabel,
  radioNewEvents,
  radioStartQueue,
  type RadioEvent,
  type RadioPlayout,
} from "./chatRadio";

/**
 * #415 Trader Radio: the one player a chat page has. It sits outside React, like the theme store,
 * so the Gainers room, every other room, DMs, pages and each Quad or Six panel show and control the
 * same radio, and there is only ever one sound.
 *
 * Off (never started, or paused) it does nothing at all: no timers and no requests.
 */

export type RadioPhase = "off" | "starting" | "listening" | "playing" | "quiet";
export type RadioState = {
  on: boolean;
  phase: RadioPhase;
  /** What is playing now, e.g. a symbol or "Station ID". */
  label: string | null;
  /** A short line for the member: why it stopped, or that a clip was skipped. */
  note: string | null;
  volume: number;
};
export const RADIO_OFF: RadioState = { on: false, phase: "off", label: null, note: null, volume: 1 };

/** How one clip finished. "blocked" is the browser refusing sound until the member taps again. */
export type RadioClipResult = "ended" | "failed" | "blocked" | "stopped";

/** Everything the player needs from a browser, so the rules can be tested without one. */
export type RadioIO = {
  now: () => number;
  /** Runs later; returns a way to cancel. */
  wait: (ms: number, run: () => void) => () => void;
  getJson: (url: string) => Promise<{ status: number; body: unknown }>;
  /** Called inside the member's tap, so the browser allows the sound that follows. */
  unlock: () => void;
  /** Plays one clip to its end on the page's single audio element. */
  play: (event: RadioEvent) => Promise<RadioClipResult>;
  silence: () => void;
  setVolume: (volume: number) => void;
  loadVolume: () => number | null;
  saveVolume: (volume: number) => void;
  /** Tells this member's other chat windows that this one is now playing. */
  announce: () => void;
};

export const RADIO_LISTEN_URL = "/api/chat/radio/listen";
/** A listening key that could not be fetched is asked for again no sooner than this. */
export const RADIO_RENEW_RETRY_MS = 30_000;
const clampVolume = (value: number | null) =>
  value === null || !Number.isFinite(value) ? 1 : Math.min(1, Math.max(0, value));

export function createChatRadio(io: RadioIO) {
  let state: RadioState = { ...RADIO_OFF, volume: clampVolume(io.loadVolume()) };
  const listeners = new Set<() => void>();
  /** Goes up on every start and stop; work begun under an older number gives up. */
  let run = 0;
  let playoutUrl: string | null = null;
  let renewAfter = 0;
  let startedAt = 0;
  let heard = new Set<string>();
  let primed = false;
  let live = true;
  let queue: RadioEvent[] = [];
  let draining = 0;
  let cancelPoll: (() => void) | null = null;
  let cancelRenew: (() => void) | null = null;
  let endGap: (() => void) | null = null;

  const set = (patch: Partial<RadioState>) => {
    const next = { ...state, ...patch };
    if ((Object.keys(next) as Array<keyof RadioState>).every((key) => next[key] === state[key])) return;
    state = next;
    listeners.forEach((listener) => listener());
  };
  const idle = () => set({ phase: live ? "listening" : "quiet", label: null, note: null });

  function stop(note: string | null = null) {
    run += 1;
    cancelPoll?.();
    cancelRenew?.();
    cancelPoll = cancelRenew = null;
    endGap?.();
    queue = [];
    io.silence();
    set({ on: false, phase: "off", label: null, note });
  }

  /** The membership check: once at start, then about every 15 minutes while playing. */
  async function renew(id: number) {
    if (io.now() < renewAfter) return;
    renewAfter = io.now() + RADIO_RENEW_RETRY_MS;
    cancelRenew?.();
    cancelRenew = null;
    let answer: { status: number; body: unknown } | null = null;
    try {
      answer = await io.getJson(RADIO_LISTEN_URL);
    } catch {
      answer = null;
    }
    if (id !== run) return;
    if (answer?.status === 401) return stop("Sign in again to listen to Trader Radio.");
    if (answer?.status === 403) return stop("Trader Radio is for members with the Gainers room.");
    const body =
      answer?.status === 200 ? (answer.body as { playout?: unknown; refreshInMs?: unknown }) : null;
    if (!body || typeof body.playout !== "string") {
      // The key in hand keeps working until it expires; try again later, never in a loop.
      cancelRenew = io.wait(RADIO_RENEW_RETRY_MS, () => void renew(id));
      return;
    }
    playoutUrl = body.playout;
    const next =
      typeof body.refreshInMs === "number" && body.refreshInMs >= 60_000 ? body.refreshInMs : 10 * 60_000;
    cancelRenew = io.wait(next, () => {
      renewAfter = 0;
      void renew(id);
    });
  }

  function take(playout: RadioPlayout) {
    live = playout.live === true;
    const events = Array.isArray(playout.events) ? playout.events : [];
    if (!primed) {
      // Nothing to start from while the relay cannot be read; wait for the first real playout.
      if (!live && !events.length) return;
      primed = true;
      const start = radioStartQueue(events, startedAt);
      heard = start.heard;
      queue.push(...start.queue);
    } else queue.push(...radioNewEvents(events, startedAt, heard));
  }

  async function drain(id: number) {
    if (draining === id) return;
    draining = id;
    while (id === run && queue.length) {
      const event = queue.shift()!;
      set({ phase: "playing", label: radioEventLabel(event), note: null });
      const result = await io.play(event);
      if (id !== run) return;
      if (result === "blocked") return stop("Press play to turn the sound on.");
      // A clip that is missing (pruned, or too long to carry) or will not play is skipped.
      if (result === "failed") set({ note: "Skipped a clip. Playing the next one." });
      await new Promise<void>((resolve) => {
        const cancel = io.wait(RADIO_GAP_MS, resolve);
        endGap = () => {
          cancel();
          resolve();
        };
      });
      endGap = null;
    }
    if (id !== run) return;
    draining = 0;
    idle();
  }

  async function poll(id: number) {
    if (id !== run) return;
    try {
      if (!playoutUrl) await renew(id);
      if (id !== run) return;
      if (playoutUrl) {
        const answer = await io.getJson(playoutUrl);
        if (id !== run) return;
        if (answer.status === 200) take(answer.body as RadioPlayout);
        else {
          live = false;
          // The key ran out (a sleeping laptop, say): fetch a new one on the next round.
          if (answer.status === 403) playoutUrl = null;
        }
      } else live = false;
    } catch {
      live = false;
    }
    if (id !== run) return;
    if (queue.length) void drain(id);
    else if (draining !== id) idle();
    cancelPoll = io.wait(RADIO_POLL_MS, () => void poll(id));
  }

  return {
    get: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Must be called from the member's tap. */
    start() {
      if (state.on) return;
      io.unlock();
      run += 1;
      playoutUrl = null;
      renewAfter = 0;
      startedAt = io.now();
      heard = new Set();
      primed = false;
      live = true;
      queue = [];
      draining = 0;
      set({ on: true, phase: "starting", label: null, note: null });
      io.setVolume(state.volume);
      io.announce();
      void poll(run);
    },
    stop,
    setVolume(value: number) {
      const volume = clampVolume(value);
      io.saveVolume(volume);
      io.setVolume(volume);
      set({ volume });
    },
  };
}
export type ChatRadio = ReturnType<typeof createChatRadio>;
