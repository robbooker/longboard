import { describe, expect, it } from "vitest";
import { RADIO_GAP_MS, RADIO_POLL_MS, type RadioEvent } from "@/lib/chatRadio";
import { createChatRadio, RADIO_LISTEN_URL, RADIO_RENEW_RETRY_MS, type RadioClipResult, type RadioIO } from "@/lib/chatRadioPlayer";

const T0 = Date.parse("2026-11-10T14:00:00Z");
const PLAYOUT = "/api/chat/radio/playout/key-1";
type Answer = { status: number; body: unknown };

/** A browser stand-in: a clock the test moves, and one "audio element" that counts overlaps. */
function rig(options: { volume?: number | null } = {}) {
  let now = T0;
  let nextTimer = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  const requests: string[] = [];
  const played: string[] = [];
  const log: string[] = [];
  let sounding: { event: RadioEvent; finish: (result: RadioClipResult) => void } | null = null;
  let mostAtOnce = 0;
  let saved: number | null = options.volume ?? null;
  const rigged = {
    listen: (): Answer | Promise<Answer> => ({ status: 200, body: { playout: PLAYOUT, refreshInMs: 13 * 60_000, expiresInMs: 28 * 60_000 } }),
    playout: (_url: string): Answer | Promise<Answer> => ({ status: 200, body: { live: true, generatedAt: null, events: [] } }),
  };
  const io: RadioIO = {
    now: () => now,
    wait(ms, run) {
      const id = nextTimer++;
      timers.set(id, { at: now + ms, run });
      return () => void timers.delete(id);
    },
    async getJson(url) {
      requests.push(url);
      return url === RADIO_LISTEN_URL ? rigged.listen() : rigged.playout(url);
    },
    unlock: () => void log.push("unlock"),
    play(event) {
      played.push(event.sourceId ?? event.line);
      mostAtOnce = Math.max(mostAtOnce, sounding ? 2 : 1);
      return new Promise<RadioClipResult>((resolve) => {
        const mine = { event, finish: (result: RadioClipResult) => {
          if (sounding === mine) sounding = null;
          resolve(result);
        } };
        sounding = mine;
      });
    },
    silence() {
      log.push("silence");
      sounding?.finish("stopped");
    },
    setVolume: (volume) => void log.push(`volume ${volume}`),
    loadVolume: () => saved,
    saveVolume: (volume) => void (saved = volume),
    announce: () => void log.push("announce"),
  };
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
  return {
    io,
    rigged,
    requests,
    played,
    log,
    timers,
    settle,
    saved: () => saved,
    mostAtOnce: () => mostAtOnce,
    sounding: () => sounding?.event.sourceId ?? null,
    async finish(result: RadioClipResult = "ended") {
      sounding?.finish(result);
      await settle();
    },
    /** Moves the clock, running every timer that comes due on the way, in order. */
    async advance(ms: number) {
      const until = now + ms;
      await settle();
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = Math.max(now, due[1].at);
        due[1].run();
        await settle();
      }
      now = until;
    },
    at: (secondsFromStart: number, extra: Partial<RadioEvent> = {}): RadioEvent => ({
      at: new Date(T0 + secondsFromStart * 1000).toISOString(),
      type: "alert",
      line: "a line",
      audioUrl: `/api/chat/radio/audio/sig/audio-cache/${extra.sourceId ?? secondsFromStart}.mp3`,
      sourceId: String(secondsFromStart),
      ...extra,
    }),
    onAir(events: RadioEvent[], live = true) {
      rigged.playout = () => ({ status: 200, body: { live, generatedAt: null, events } });
    },
  };
}

describe("Trader Radio player", () => {
  it("is off until play is pressed: no requests, no timers, no sound", async () => {
    const r = rig();
    const radio = createChatRadio(r.io);
    radio.subscribe(() => {});
    await r.advance(10 * 60_000);
    expect(radio.get()).toMatchObject({ on: false, phase: "off" });
    expect(r.requests).toEqual([]);
    expect(r.timers.size).toBe(0);
    expect(r.log).toEqual([]);
  });
  it("on play: unlocks sound inside the tap, checks membership once, then follows the playout", async () => {
    const r = rig();
    const radio = createChatRadio(r.io);
    radio.start();
    expect(r.log).toEqual(["unlock", "volume 1", "announce"]);
    expect(radio.get()).toMatchObject({ on: true, phase: "starting" });
    await r.settle();
    expect(r.requests).toEqual([RADIO_LISTEN_URL, PLAYOUT]);
    expect(radio.get().phase).toBe("listening");
    await r.advance(3 * RADIO_POLL_MS);
    expect(r.requests).toEqual([RADIO_LISTEN_URL, PLAYOUT, PLAYOUT, PLAYOUT, PLAYOUT]);
  });
  it("starts at the live point: the newest squawk, never the backlog", async () => {
    const r = rig();
    r.onAir([r.at(-600), r.at(-300), r.at(-20, { symbol: "PXLW" })]);
    const radio = createChatRadio(r.io);
    radio.start();
    await r.settle();
    expect(r.played).toEqual(["-20"]);
    expect(radio.get()).toMatchObject({ phase: "playing", label: "PXLW" });
    await r.finish();
    await r.advance(5 * RADIO_POLL_MS);
    expect(r.played).toEqual(["-20"]);
    expect(radio.get()).toMatchObject({ phase: "listening", label: null });
  });
  it("plays later squawks once each, in order, and never two at the same time", async () => {
    const r = rig();
    const first = [r.at(-20)];
    r.onAir(first);
    const radio = createChatRadio(r.io);
    radio.start();
    await r.settle();
    // Three more arrive over the next polls while the first clip is still sounding.
    r.onAir([...first, r.at(12), r.at(5)]);
    await r.advance(RADIO_POLL_MS);
    r.onAir([...first, r.at(12), r.at(5), r.at(15)]);
    await r.advance(2 * RADIO_POLL_MS);
    expect(r.played).toEqual(["-20"]);
    for (let clip = 0; clip < 4; clip += 1) {
      await r.finish();
      await r.advance(RADIO_GAP_MS);
    }
    expect(r.played).toEqual(["-20", "5", "12", "15"]);
    expect(r.mostAtOnce()).toBe(1);
    await r.advance(3 * RADIO_POLL_MS);
    expect(r.played).toHaveLength(4);
  });
  it("skips a clip that is missing or will not play, and carries on", async () => {
    const r = rig();
    const list = { playlistId: "evening", type: "episode" as const };
    r.onAir([r.at(-30, { ...list, sequenceIndex: 0, sourceId: "a" }), r.at(-30, { ...list, sequenceIndex: 1, sourceId: "b" })]);
    const radio = createChatRadio(r.io);
    radio.start();
    await r.settle();
    expect(r.sounding()).toBe("a");
    await r.finish("failed");
    expect(radio.get().note).toBe("Skipped a clip. Playing the next one.");
    await r.advance(RADIO_GAP_MS);
    expect(r.sounding()).toBe("b");
    expect(radio.get().note).toBeNull();
    expect(radio.get().on).toBe(true);
  });
  it("pause stops everything: the sound, the polling and the membership renewals", async () => {
    const r = rig();
    r.onAir([r.at(-20), r.at(-20, { sourceId: "x" })]);
    const radio = createChatRadio(r.io);
    radio.start();
    await r.settle();
    const before = r.requests.length;
    radio.stop();
    expect(r.log.at(-1)).toBe("silence");
    expect(radio.get()).toMatchObject({ on: false, phase: "off", label: null, note: null });
    await r.settle();
    expect(r.timers.size).toBe(0);
    await r.advance(30 * 60_000);
    expect(r.requests).toHaveLength(before);
    expect(r.played).toHaveLength(1);
  });
  it("pause in the breath between two clips leaves nothing running either", async () => {
    const r = rig();
    const list = { playlistId: "p" };
    r.onAir([r.at(-20, { ...list, sequenceIndex: 0, sourceId: "a" }), r.at(-20, { ...list, sequenceIndex: 1, sourceId: "b" })]);
    const radio = createChatRadio(r.io);
    radio.start();
    await r.settle();
    await r.finish();
    radio.stop();
    await r.settle();
    expect(r.timers.size).toBe(0);
    await r.advance(60_000);
    expect(r.played).toEqual(["a"]);
  });
  it("pause then play again starts fresh, still with one sound", async () => {
    const r = rig();
    r.onAir([r.at(-20)]);
    const radio = createChatRadio(r.io);
    radio.start();
    await r.settle();
    radio.stop();
    radio.start();
    radio.start(); // a second panel's button, or a double tap
    await r.settle();
    expect(r.requests.filter((url) => url === RADIO_LISTEN_URL)).toHaveLength(2);
    expect(r.played).toEqual(["-20", "-20"]);
    expect(r.mostAtOnce()).toBe(1);
    await r.advance(RADIO_POLL_MS);
    // One poll loop, not two.
    expect(r.requests.filter((url) => url === PLAYOUT)).toHaveLength(3);
  });
  it("turns itself off, with the reason, when the member is signed out or loses the room", async () => {
    for (const [status, note] of [[401, "Sign in again to listen to Trader Radio."], [403, "Trader Radio is for members with the Gainers room."]] as const) {
      const r = rig();
      r.rigged.listen = () => ({ status, body: { error: "no" } });
      const radio = createChatRadio(r.io);
      radio.start();
      await r.settle();
      expect(radio.get()).toMatchObject({ on: false, phase: "off", note });
      await r.advance(10 * 60_000);
      expect(r.requests).toEqual([RADIO_LISTEN_URL]);
      expect(r.timers.size).toBe(0);
    }
  });
  it("turns itself off and asks for a tap when the browser refuses sound", async () => {
    const r = rig();
    r.onAir([r.at(-20)]);
    const radio = createChatRadio(r.io);
    radio.start();
    await r.settle();
    await r.finish("blocked");
    expect(radio.get()).toMatchObject({ on: false, note: "Press play to turn the sound on." });
    expect(r.timers.size).toBe(0);
  });
  it("is quiet, not in an error loop, when the network or the server is down", async () => {
    const r = rig();
    r.rigged.listen = () => Promise.reject(new Error("offline"));
    const radio = createChatRadio(r.io);
    radio.start();
    await r.settle();
    expect(radio.get()).toMatchObject({ on: true, phase: "quiet", note: null });
    await r.advance(5 * 60_000);
    // Membership is asked for at most once per 30 seconds, and the playout not at all without a key.
    expect(r.requests.every((url) => url === RADIO_LISTEN_URL)).toBe(true);
    expect(r.requests.length).toBeLessThanOrEqual(1 + (5 * 60_000) / RADIO_RENEW_RETRY_MS);
    // And it recovers by itself.
    r.rigged.listen = () => ({ status: 200, body: { playout: PLAYOUT, refreshInMs: 13 * 60_000 } });
    await r.advance(RADIO_RENEW_RETRY_MS + RADIO_POLL_MS);
    expect(radio.get().phase).toBe("listening");
  });
  it("says 'no squawks right now' when the relay is silent, and keeps to one poll per 10 seconds", async () => {
    const r = rig();
    r.onAir([], false);
    const radio = createChatRadio(r.io);
    radio.start();
    await r.settle();
    expect(radio.get().phase).toBe("quiet");
    r.rigged.playout = () => ({ status: 500, body: null });
    await r.advance(60_000);
    expect(radio.get().phase).toBe("quiet");
    expect(r.requests.filter((url) => url === PLAYOUT)).toHaveLength(7);
    // Back on air: what was squawked while it was away is not replayed, the next squawk is.
    r.onAir([r.at(30), r.at(75)]);
    await r.advance(RADIO_POLL_MS);
    expect(r.played).toEqual(["75"]);
  });
  it("renews its key about every 15 minutes while playing, and at once if the key has run out", async () => {
    const r = rig();
    const radio = createChatRadio(r.io);
    radio.start();
    await r.settle();
    r.rigged.listen = () => ({ status: 200, body: { playout: "/api/chat/radio/playout/key-2", refreshInMs: 15 * 60_000 } });
    await r.advance(13 * 60_000 + RADIO_POLL_MS);
    expect(r.requests.filter((url) => url === RADIO_LISTEN_URL)).toHaveLength(2);
    expect(r.requests.at(-1)).toBe("/api/chat/radio/playout/key-2");
    // A laptop that slept past the key's life: the playout says no, the next round fetches a new key.
    r.rigged.playout = () => ({ status: 403, body: { error: "radio_key_expired" } });
    r.rigged.listen = () => ({ status: 200, body: { playout: "/api/chat/radio/playout/key-3", refreshInMs: 15 * 60_000 } });
    await r.advance(RADIO_POLL_MS);
    r.rigged.playout = () => ({ status: 200, body: { live: true, generatedAt: null, events: [] } });
    await r.advance(RADIO_POLL_MS);
    expect(r.requests.at(-1)).toBe("/api/chat/radio/playout/key-3");
    expect(radio.get()).toMatchObject({ on: true, phase: "listening" });
  });
  it("remembers the volume, keeps it between 0 and 1, and applies it at once", async () => {
    const r = rig({ volume: 0.35 });
    const radio = createChatRadio(r.io);
    expect(radio.get().volume).toBe(0.35);
    radio.setVolume(0.6);
    expect(r.saved()).toBe(0.6);
    expect(r.log.at(-1)).toBe("volume 0.6");
    radio.setVolume(7);
    expect(radio.get().volume).toBe(1);
    radio.setVolume(Number.NaN);
    expect(radio.get().volume).toBe(1);
    expect(createChatRadio(rig({ volume: -3 }).io).get().volume).toBe(0);
    expect(r.requests).toEqual([]);
  });
  it("tells its listeners only when something changed", async () => {
    const r = rig();
    const radio = createChatRadio(r.io);
    let told = 0;
    const off = radio.subscribe(() => (told += 1));
    radio.start();
    await r.settle();
    const afterStart = told;
    await r.advance(10 * RADIO_POLL_MS);
    expect(told).toBe(afterStart);
    off();
    radio.stop();
    expect(told).toBe(afterStart);
  });
});
