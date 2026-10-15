// CHAT-TIMING: how fast the chat feels on real phones and computers.
//
// One in five browser sessions (decided once per tab session) measures six timings and sends
// them in one small batch when the tab hides. A batch carries only the metric name, a number,
// the room slug and "phone" or "desktop": no message text, no names, no member or message ids.
// The pieces here are pure so the sampling, batching and server validation are unit-tested;
// the browser side is components/chat/room/useChatTimings.ts.
import { CHAT_ROOMS, type ChatRoom } from "@/lib/publicChat";

/**
 * The six timings. Values are whole milliseconds, except wrong_landing which is pixels.
 *  - open_first_message: page start (navigation) to the first message row painted in the room.
 *  - room_switch: the tap/key that changed rooms to the new room's first message row painted.
 *  - send_visible: pressing Send to the server-confirmed message row painted (text-only sends).
 *  - delivery_lag: someone else's message, server created_at to its row painted here
 *    (realtime arrivals only; corrected for this device's clock offset).
 *  - tap_response: a tap/click on a control to the next painted frame.
 *  - wrong_landing: how far (px) the room opened from where it meant to; 0 = right spot.
 */
export const CHAT_TIMING_METRICS = [
  "open_first_message",
  "room_switch",
  "send_visible",
  "delivery_lag",
  "tap_response",
  "wrong_landing",
] as const;
export type ChatTimingMetric = (typeof CHAT_TIMING_METRICS)[number];
export type ChatTimingDevice = "phone" | "desktop";
export type ChatTimingRow = { m: ChatTimingMetric; v: number; r: ChatRoom };
export type ChatTimingBatch = { device: ChatTimingDevice; rows: ChatTimingRow[] };

/** Anything above these is a stalled tab or a replay, not a timing; it is dropped. */
export const CHAT_TIMING_MAX: Record<ChatTimingMetric, number> = {
  open_first_message: 120_000,
  room_switch: 60_000,
  send_visible: 60_000,
  delivery_lag: 120_000,
  tap_response: 10_000,
  wrong_landing: 100_000,
};

export const CHAT_TIMING_SAMPLE_RATE = 0.2;
export const CHAT_TIMING_SAMPLE_KEY = "longboard-chat-timings-v1";
/** Per-metric cap per batch (reservoir sampled, so a long session isn't biased to its start). */
export const CHAT_TIMING_PER_METRIC = 10;
export const CHAT_TIMING_MAX_ROWS = CHAT_TIMING_METRICS.length * CHAT_TIMING_PER_METRIC;
/** Bytes; a full batch is about 2.5 KB. */
export const CHAT_TIMING_MAX_BODY = 8_192;
export const CHAT_TIMING_ENDPOINT = "/api/chat/timings";

const ROOMS = new Set<string>(CHAT_ROOMS.map((room) => room.slug));
const METRICS = new Set<string>(CHAT_TIMING_METRICS);

type SampleStore = Pick<Storage, "getItem" | "setItem">;

/**
 * Decides once per tab session whether it records timings. The choice is kept in
 * sessionStorage so reloads keep it; without storage it is decided once per page.
 */
export function decideChatTimingSample(
  store: SampleStore | null,
  random: () => number = Math.random,
): boolean {
  try {
    const kept = store?.getItem(CHAT_TIMING_SAMPLE_KEY);
    if (kept === "1" || kept === "0") return kept === "1";
  } catch {}
  const sampled = random() < CHAT_TIMING_SAMPLE_RATE;
  try {
    store?.setItem(CHAT_TIMING_SAMPLE_KEY, sampled ? "1" : "0");
  } catch {}
  return sampled;
}

/** Keeps at most CHAT_TIMING_PER_METRIC rows per metric until taken. */
export class ChatTimingBuffer {
  private rows = new Map<ChatTimingMetric, ChatTimingRow[]>();
  private seen = new Map<ChatTimingMetric, number>();
  constructor(private random: () => number = Math.random) {}

  add(metric: ChatTimingMetric, value: number, room: ChatRoom): boolean {
    if (!METRICS.has(metric) || !ROOMS.has(room) || !Number.isFinite(value)) return false;
    const v = Math.round(value);
    if (v < 0 || v > CHAT_TIMING_MAX[metric]) return false;
    const row: ChatTimingRow = { m: metric, v, r: room };
    const list = this.rows.get(metric) ?? [];
    const seen = (this.seen.get(metric) ?? 0) + 1;
    this.seen.set(metric, seen);
    if (list.length < CHAT_TIMING_PER_METRIC) list.push(row);
    else {
      // Reservoir sampling: every timing of the session has the same chance to be kept.
      const slot = Math.floor(this.random() * seen);
      if (slot >= CHAT_TIMING_PER_METRIC) return false;
      list[slot] = row;
    }
    this.rows.set(metric, list);
    return true;
  }

  get size() {
    let size = 0;
    for (const list of this.rows.values()) size += list.length;
    return size;
  }

  /** Returns everything buffered and empties the buffer (a batch is never sent twice). */
  take(): ChatTimingRow[] {
    const rows = [...this.rows.values()].flat();
    this.rows.clear();
    this.seen.clear();
    return rows;
  }
}

export function encodeChatTimingBatch(device: ChatTimingDevice, rows: ChatTimingRow[]): string | null {
  if (!rows.length) return null;
  return JSON.stringify({ device, rows: rows.slice(0, CHAT_TIMING_MAX_ROWS) });
}

/**
 * Server-side check of a posted batch. Strict: an unknown key, metric, room or device, a value
 * out of range or too many rows rejects the whole batch. Text of any kind cannot get through:
 * every string must be one of the fixed names above.
 */
export function parseChatTimingBatch(text: string): ChatTimingBatch | null {
  if (text.length > CHAT_TIMING_MAX_BODY) return null;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const { device, rows, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length) return null;
  if (device !== "phone" && device !== "desktop") return null;
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > CHAT_TIMING_MAX_ROWS) return null;
  const counts = new Map<string, number>();
  const parsed: ChatTimingRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const { m, v, r, ...extra } = row as Record<string, unknown>;
    if (Object.keys(extra).length) return null;
    if (typeof m !== "string" || !METRICS.has(m)) return null;
    if (typeof r !== "string" || !ROOMS.has(r)) return null;
    const metric = m as ChatTimingMetric;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > CHAT_TIMING_MAX[metric]) return null;
    const count = (counts.get(m) ?? 0) + 1;
    if (count > CHAT_TIMING_PER_METRIC) return null;
    counts.set(m, count);
    parsed.push({ m: metric, v, r: r as ChatRoom });
  }
  return { device, rows: parsed };
}

/**
 * Fixed-window limit per caller key (per server instance). A sampled session sends one batch
 * per tab hide, so 12 batches in 10 minutes is far above normal use.
 */
export class ChatTimingRateLimit {
  private hits = new Map<string, { start: number; count: number }>();
  constructor(
    private limit = 12,
    private windowMs = 10 * 60_000,
    private maxKeys = 5_000,
  ) {}
  allow(key: string, now = Date.now()): boolean {
    const hit = this.hits.get(key);
    if (!hit || now - hit.start >= this.windowMs) {
      if (this.hits.size >= this.maxKeys) {
        for (const [k, h] of this.hits) if (now - h.start >= this.windowMs) this.hits.delete(k);
        if (this.hits.size >= this.maxKeys) this.hits.clear();
      }
      this.hits.set(key, { start: now, count: 1 });
      return true;
    }
    if (hit.count >= this.limit) return false;
    hit.count++;
    return true;
  }
}

/**
 * Clock offset from one round trip: server time minus this device's time, assuming the server
 * read its clock half way through. Rejected when the round trip is too slow to trust.
 */
export function chatClockOffset(sentAt: number, receivedAt: number, serverNow: number, maxRoundTrip = 1500) {
  const roundTrip = receivedAt - sentAt;
  if (!Number.isFinite(serverNow) || !(roundTrip >= 0) || roundTrip > maxRoundTrip) return null;
  return { offset: serverNow - (sentAt + receivedAt) / 2, error: roundTrip / 2 };
}

/** Lag from a server timestamp to now, in server time. Null when the clock can't support it. */
export function chatDeliveryLag(createdAt: string, deviceNow: number, clock: { offset: number; error: number } | null) {
  if (!clock) return null;
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return null;
  const lag = deviceNow + clock.offset - created;
  // Slightly negative is within the offset's error; much more negative means a bad offset.
  if (lag < -(clock.error + 50)) return null;
  return Math.max(0, lag);
}

/**
 * wrong_landing in pixels. With an anchor (the first unread message), the room opened right if
 * any part of that row is inside the list's viewport; otherwise it is the gap to the viewport.
 * Without an anchor the room should open at the newest message (bottom, 2px tolerance).
 */
export function chatLandingDistance(
  pane: { top: number; bottom: number; scrollHeight: number; scrollTop: number; clientHeight: number },
  anchorRow: { top: number; bottom: number } | null | undefined,
  hasAnchor: boolean,
): number {
  if (hasAnchor) {
    if (!anchorRow) return Math.max(1, pane.clientHeight);
    if (anchorRow.bottom > pane.top && anchorRow.top < pane.bottom) return 0;
    return Math.ceil(anchorRow.bottom <= pane.top ? pane.top - anchorRow.bottom + 1 : anchorRow.top - pane.bottom + 1);
  }
  const fromBottom = pane.scrollHeight - pane.scrollTop - pane.clientHeight;
  return fromBottom <= 2 ? 0 : Math.ceil(fromBottom);
}
