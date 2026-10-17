import { describe, expect, it } from "vitest";
import {
  CHAT_TIMING_MAX_ROWS,
  CHAT_TIMING_PER_METRIC,
  CHAT_TIMING_SAMPLE_KEY,
  ChatTimingBuffer,
  ChatTimingRateLimit,
  chatClockOffset,
  chatDeliveryLag,
  chatLandingDistance,
  chatLandingWhen,
  decideChatTimingSample,
  encodeChatTimingBatch,
  parseChatTimingBatch,
} from "@/lib/chatTimings";

function memoryStore() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), map };
}

describe("sampling", () => {
  it("samples about 1 in 5 sessions", () => {
    let sampled = 0;
    for (let i = 0; i < 1000; i++) if (decideChatTimingSample(memoryStore(), () => i / 1000)) sampled++;
    expect(sampled).toBe(200);
  });
  it("decides once per session and keeps the choice", () => {
    const store = memoryStore();
    expect(decideChatTimingSample(store, () => 0.1)).toBe(true);
    expect(store.map.get(CHAT_TIMING_SAMPLE_KEY)).toBe("1");
    expect(decideChatTimingSample(store, () => 0.9)).toBe(true);
    const other = memoryStore();
    expect(decideChatTimingSample(other, () => 0.9)).toBe(false);
    expect(decideChatTimingSample(other, () => 0.1)).toBe(false);
  });
  it("still decides when storage throws", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(decideChatTimingSample(broken, () => 0.5)).toBe(false);
    expect(decideChatTimingSample(null, () => 0)).toBe(true);
  });
});

describe("batching", () => {
  it("caps each metric and the whole batch, and empties on take", () => {
    const buffer = new ChatTimingBuffer(() => 0.99);
    for (let i = 0; i < 500; i++) {
      buffer.add("tap_response", i, "main");
      buffer.add("delivery_lag", i, "social");
    }
    expect(buffer.size).toBe(2 * CHAT_TIMING_PER_METRIC);
    const rows = buffer.take();
    expect(rows).toHaveLength(2 * CHAT_TIMING_PER_METRIC);
    expect(buffer.size).toBe(0);
    expect(buffer.take()).toEqual([]);
  });
  it("reservoir-samples later timings in", () => {
    const buffer = new ChatTimingBuffer(() => 0);
    for (let i = 0; i < 50; i++) buffer.add("room_switch", i, "main");
    expect(buffer.take().map((row) => row.v)).toContain(49);
  });
  it("drops bad values, rooms and metrics", () => {
    const buffer = new ChatTimingBuffer();
    expect(buffer.add("tap_response", -1, "main")).toBe(false);
    expect(buffer.add("tap_response", Number.NaN, "main")).toBe(false);
    expect(buffer.add("tap_response", 10_001, "main")).toBe(false);
    expect(buffer.add("tap_response", 12.6, "dm-1234" as never)).toBe(false);
    expect(buffer.add("bogus" as never, 1, "main")).toBe(false);
    expect(buffer.add("tap_response", 12.6, "main")).toBe(true);
    expect(buffer.take()).toEqual([{ m: "tap_response", v: 13, r: "main" }]);
  });
  it("encodes a small batch and nothing for an empty buffer", () => {
    expect(encodeChatTimingBatch("phone", [])).toBeNull();
    const buffer = new ChatTimingBuffer();
    for (const metric of ["open_first_message", "room_switch", "send_visible", "delivery_lag", "tap_response", "wrong_landing"] as const)
      for (let i = 0; i < 40; i++) buffer.add(metric, 9_999, "lb-announcements", "off");
    const body = encodeChatTimingBatch("desktop", buffer.take())!;
    expect(body.length).toBeLessThan(4_096);
    expect(parseChatTimingBatch(body)?.rows).toHaveLength(CHAT_TIMING_MAX_ROWS);
  });
});

describe("server validation", () => {
  const ok = { device: "phone", rows: [{ m: "send_visible", v: 420, r: "main" }] };
  it("accepts a well-formed batch", () => {
    expect(parseChatTimingBatch(JSON.stringify(ok))).toEqual({ device: "phone", rows: [{ m: "send_visible", v: 420, r: "main" }] });
  });
  it("keeps the stream tag (EVENT-STREAM step 3) and rows without one", () => {
    const rows = [
      { m: "send_visible", v: 420, r: "main", s: "on" },
      { m: "delivery_lag", v: 80, r: "main", s: "off" },
      { m: "tap_response", v: 20, r: "main" },
    ];
    expect(parseChatTimingBatch(JSON.stringify({ device: "desktop", rows }))).toEqual({ device: "desktop", rows });
    const buffer = new ChatTimingBuffer();
    buffer.add("tap_response", 12, "main", "on");
    buffer.add("room_switch", 200, "social");
    expect(buffer.take()).toEqual([
      { m: "tap_response", v: 12, r: "main", s: "on" },
      { m: "room_switch", v: 200, r: "social" },
    ]);
  });
  it.each([
    ["not json", "{"],
    ["array", "[]"],
    ["unknown device", JSON.stringify({ ...ok, device: "tablet" })],
    ["extra top-level field", JSON.stringify({ ...ok, member: "abc" })],
    ["extra row field (text)", JSON.stringify({ device: "phone", rows: [{ m: "send_visible", v: 1, r: "main", body: "hello" }] })],
    ["unknown stream tag", JSON.stringify({ device: "phone", rows: [{ m: "send_visible", v: 1, r: "main", s: "yes" }] })],
    ["stream tag carrying text", JSON.stringify({ device: "phone", rows: [{ m: "send_visible", v: 1, r: "main", s: "alice@example.test" }] })],
    ["unknown metric", JSON.stringify({ device: "phone", rows: [{ m: "typing", v: 1, r: "main" }] })],
    ["unknown room", JSON.stringify({ device: "phone", rows: [{ m: "send_visible", v: 1, r: "Rob's DM" }] })],
    ["fractional value", JSON.stringify({ device: "phone", rows: [{ m: "send_visible", v: 1.5, r: "main" }] })],
    ["negative value", JSON.stringify({ device: "phone", rows: [{ m: "send_visible", v: -3, r: "main" }] })],
    ["too large value", JSON.stringify({ device: "phone", rows: [{ m: "tap_response", v: 10_001, r: "main" }] })],
    ["string value", JSON.stringify({ device: "phone", rows: [{ m: "send_visible", v: "5", r: "main" }] })],
    ["no rows", JSON.stringify({ device: "phone", rows: [] })],
    ["too many of one metric", JSON.stringify({ device: "phone", rows: Array.from({ length: CHAT_TIMING_PER_METRIC + 1 }, () => ({ m: "tap_response", v: 1, r: "main" })) })],
    ["too many rows", JSON.stringify({ device: "phone", rows: Array.from({ length: CHAT_TIMING_MAX_ROWS + 1 }, () => ({ m: "tap_response", v: 1, r: "main" })) })],
    ["oversized body", JSON.stringify({ ...ok, pad: "x".repeat(9_000) })],
  ])("rejects %s", (_name, text) => expect(parseChatTimingBatch(text)).toBeNull());
});

describe("rate limit", () => {
  it("allows a burst per key per window", () => {
    const limit = new ChatTimingRateLimit(3, 1000);
    expect([1, 2, 3, 4].map(() => limit.allow("a", 0))).toEqual([true, true, true, false]);
    expect(limit.allow("b", 0)).toBe(true);
    expect(limit.allow("a", 1000)).toBe(true);
  });
  it("stays bounded in memory", () => {
    const limit = new ChatTimingRateLimit(1, 1000, 10);
    for (let i = 0; i < 100; i++) limit.allow(`k${i}`, 0);
    expect((limit as unknown as { hits: Map<string, unknown> }).hits.size).toBeLessThanOrEqual(10);
  });
});

describe("clock and delivery lag", () => {
  it("corrects for a device clock that runs 5 minutes fast", () => {
    const clock = chatClockOffset(1_000_300_000, 1_000_300_200, 1_000_000_100)!;
    expect(clock).toEqual({ offset: -300_000, error: 100 });
    const created = new Date(1_000_000_500).toISOString();
    expect(chatDeliveryLag(created, 1_000_300_800, clock)).toBe(300);
  });
  it("refuses slow round trips and implausible lags", () => {
    expect(chatClockOffset(0, 2_000, 1_000)).toBeNull();
    const clock = { offset: 0, error: 50 };
    expect(chatDeliveryLag(new Date(10_000).toISOString(), 9_000, clock)).toBeNull();
    expect(chatDeliveryLag(new Date(10_000).toISOString(), 9_960, clock)).toBe(0);
    expect(chatDeliveryLag("nope", 9_960, clock)).toBeNull();
    expect(chatDeliveryLag(new Date(10_000).toISOString(), 10_500, null)).toBeNull();
  });
});

describe("wrong landing", () => {
  const pane = { top: 100, bottom: 600, scrollHeight: 3000, scrollTop: 2500, clientHeight: 500 };
  it("is 0 when the unread anchor row is on screen", () => {
    expect(chatLandingDistance(pane, { top: 120, bottom: 160 }, true)).toBe(0);
    expect(chatLandingDistance(pane, { top: 580, bottom: 640 }, true)).toBe(0);
  });
  it("is the gap when the anchor row is off screen or missing", () => {
    expect(chatLandingDistance(pane, { top: 20, bottom: 60 }, true)).toBe(41);
    expect(chatLandingDistance(pane, { top: 900, bottom: 940 }, true)).toBe(301);
    expect(chatLandingDistance(pane, null, true)).toBe(500);
  });
  it("without an anchor, measures the distance from the newest message", () => {
    expect(chatLandingDistance(pane, null, false)).toBe(0);
    expect(chatLandingDistance({ ...pane, scrollTop: 2498 }, null, false)).toBe(0);
    expect(chatLandingDistance({ ...pane, scrollTop: 2000 }, null, false)).toBe(500);
  });
});

describe("when the landing is judged", () => {
  it("judges a room on screen right away", () => {
    expect(chatLandingWhen({ shown: true, covered: false, behindList: false })).toBe("now");
  });
  it("waits for a room under the phone's list to be opened from it", () => {
    expect(chatLandingWhen({ shown: false, covered: false, behindList: true })).toBe("later");
  });
  it("never judges a list covered by a phone's reply panel or search, or a room behind a DM", () => {
    expect(chatLandingWhen({ shown: true, covered: true, behindList: false })).toBe("never");
    expect(chatLandingWhen({ shown: false, covered: false, behindList: false })).toBe("never");
  });
  it("a list never laid out reads as the whole room off (why a covered list must not be judged)", () => {
    // 80 rows at scrollTop 0, the unread thread's parent near the bottom.
    const unlaid = { top: 57, bottom: 784, scrollHeight: 8438, scrollTop: 0, clientHeight: 727 };
    expect(chatLandingDistance(unlaid, { top: 6900, bottom: 7000 }, true)).toBeGreaterThan(6000);
    expect(chatLandingDistance(unlaid, null, false)).toBe(7711);
  });
});
