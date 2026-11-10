import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  RADIO_KEY_WINDOW_MS,
  radioClipPath,
  radioClipUrl,
  radioKeyTiming,
  radioListenKey,
  radioPlayout,
  validRadioClip,
  validRadioListenKey,
} from "@/lib/chatRadioAccess";

const NOW = Date.parse("2026-11-10T14:03:00Z");
const saved = process.env.SUPABASE_SERVICE_ROLE_KEY;
beforeEach(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
});
afterEach(() => {
  if (saved === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = saved;
});

describe("Trader Radio listening key", () => {
  it("is the same for everyone inside a window, so listeners share one cached playout", () => {
    expect(radioListenKey(NOW)).toBe(radioListenKey(NOW + 60_000));
    expect(radioListenKey(NOW)).not.toBe(radioListenKey(NOW + RADIO_KEY_WINDOW_MS));
  });
  it("works for its window and the next one, then stops", () => {
    const key = radioListenKey(NOW)!;
    expect(validRadioListenKey(key, NOW)).toBe(true);
    expect(validRadioListenKey(key, NOW + RADIO_KEY_WINDOW_MS)).toBe(true);
    expect(validRadioListenKey(key, NOW + 2 * RADIO_KEY_WINDOW_MS)).toBe(false);
    expect(validRadioListenKey(key, NOW - RADIO_KEY_WINDOW_MS)).toBe(false);
  });
  it("refuses a made-up key, and every key when the server secret is missing", () => {
    const key = radioListenKey(NOW)!;
    expect(validRadioListenKey("x".repeat(key.length), NOW)).toBe(false);
    expect(validRadioListenKey("", NOW)).toBe(false);
    process.env.SUPABASE_SERVICE_ROLE_KEY = "another-deployment";
    expect(validRadioListenKey(key, NOW)).toBe(false);
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(radioListenKey(NOW)).toBeNull();
    expect(validRadioListenKey(key, NOW)).toBe(false);
  });
  it("never shows the server secret", () => {
    expect(radioListenKey(NOW)).not.toContain("test-service-role-key");
    expect(radioListenKey(NOW)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  it("spreads renewals after the window turns, always before the key runs out", () => {
    const turnsIn = 12 * 60_000; // 14:03 → 14:15
    const early = radioKeyTiming(NOW, () => 0);
    const late = radioKeyTiming(NOW, () => 0.999999);
    expect(early.refreshInMs).toBe(turnsIn + 5_000);
    expect(late.refreshInMs).toBeGreaterThan(turnsIn + 12 * 60_000);
    expect(late.refreshInMs).toBeLessThan(late.expiresInMs - 60_000);
    expect(early.expiresInMs).toBe(turnsIn + RADIO_KEY_WINDOW_MS);
    expect(validRadioListenKey(radioListenKey(NOW)!, NOW + late.refreshInMs)).toBe(true);
  });
});

describe("Trader Radio clip addresses", () => {
  it("reads the relay's own addresses and nothing else", () => {
    expect(radioClipPath("/api/squawkbox/relay-audio/audio-cache/line-abc.mp3")).toBe("audio-cache/line-abc.mp3");
    expect(radioClipPath("/api/squawkbox/relay-audio/sounds/evening/trade%20well.mp3")).toBe("sounds/evening/trade well.mp3");
    expect(radioClipPath("/api/squawkbox/relay-audio/smoke-probe/x.mp3")).toBeNull();
    expect(radioClipPath("/api/squawkbox/relay-audio/audio-cache/../secrets")).toBeNull();
    expect(radioClipPath("/api/squawkbox/relay-audio/audio-cache/%2e%2e/x")).toBeNull();
    expect(radioClipPath("/api/squawkbox/relay-audio/audio-cache")).toBeNull();
    expect(radioClipPath("https://elsewhere.example/a.mp3")).toBeNull();
    expect(radioClipPath(undefined)).toBeNull();
  });
  it("signs a clip the same way every time, and only that clip", () => {
    const url = radioClipUrl("audio-cache/line-abc.mp3")!;
    expect(url).toBe(radioClipUrl("audio-cache/line-abc.mp3"));
    const [, signature] = url.match(/^\/api\/chat\/radio\/audio\/([A-Za-z0-9_-]{43})\/audio-cache\/line-abc\.mp3$/)!;
    expect(validRadioClip(signature, "audio-cache/line-abc.mp3")).toBe(true);
    expect(validRadioClip(signature, "audio-cache/line-xyz.mp3")).toBe(false);
    expect(validRadioClip(signature, "audio-cache/../audio-cache/line-abc.mp3")).toBe(false);
    expect(validRadioClip("", "audio-cache/line-abc.mp3")).toBe(false);
  });
});

describe("Trader Radio playout", () => {
  const raw = (extra: Record<string, unknown>) => ({
    at: "2026-11-10T14:00:00.000Z",
    type: "alert",
    line: "P X L W. Price 6 dollars.",
    audioUrl: "/api/squawkbox/relay-audio/audio-cache/line-1.mp3",
    audioPath: "/Users/someone/TraderRadio/data/line-1.mp3",
    sourceMessage: "the raw alert",
    sourceChannel: "a private channel",
    played: false,
    ...extra,
  });
  const row = (events: unknown[], updated_at = "2026-11-10T14:02:55Z") => ({ events, generatedAt: "2026-11-10T14:02:54Z", updated_at });

  it("hands on only what the player needs, with signed clip addresses", () => {
    const playout = radioPlayout(row([raw({ symbol: "PXLW", sourceId: "45169508352", sourceTime: "2026-11-10T13:59:50Z" })]), NOW);
    expect(playout.live).toBe(true);
    expect(playout.generatedAt).toBe("2026-11-10T14:02:54Z");
    expect(playout.events).toEqual([
      {
        at: "2026-11-10T14:00:00.000Z",
        type: "alert",
        line: "P X L W. Price 6 dollars.",
        audioUrl: radioClipUrl("audio-cache/line-1.mp3"),
        symbol: "PXLW",
        session: undefined,
        sourceId: "45169508352",
        sourceTime: "2026-11-10T13:59:50Z",
        playlistId: undefined,
        sequenceIndex: undefined,
      },
    ]);
    expect(JSON.stringify(playout)).not.toMatch(/Users|sourceMessage|private channel|relay-audio/);
  });
  it("keeps the relay's order and drops what cannot or must not be played", () => {
    const playout = radioPlayout(
      row([
        raw({ sourceId: "a" }),
        raw({ sourceId: "no-clip", audioUrl: undefined }),
        raw({ sourceId: "elsewhere", audioUrl: "https://elsewhere.example/x.mp3" }),
        raw({ type: "station", line: "TraderRadio, live." }),
        raw({ type: "overview", line: "Markets are closed today for the holiday." }),
        raw({ type: "mystery" }),
        "not an event",
        raw({ type: "station", line: "This is TraderRadio After Dark.", sourceId: "b" }),
      ]),
      NOW,
    );
    expect(playout.events.map((event) => event.sourceId)).toEqual(["a", "b"]);
  });
  it("says off air when the relay has stopped writing or cannot be read", () => {
    expect(radioPlayout(row([raw({})], "2026-11-10T13:50:00Z"), NOW).live).toBe(false);
    expect(radioPlayout(row([raw({})], "2026-11-10T13:50:00Z"), NOW).events).toHaveLength(1);
    expect(radioPlayout(null, NOW)).toEqual({ live: false, generatedAt: null, events: [] });
    expect(radioPlayout({ events: "broken", generatedAt: 5, updated_at: null }, NOW)).toEqual({ live: false, generatedAt: null, events: [] });
  });
});
