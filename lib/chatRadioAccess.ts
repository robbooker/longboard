import { createHmac, timingSafeEqual } from "node:crypto";
import {
  RADIO_EVENT_TYPES,
  radioLineBlocked,
  type RadioEvent,
  type RadioEventType,
  type RadioPlayout,
} from "./chatRadio";

/**
 * #415 Trader Radio: who may fetch what, without a database question per request.
 *
 * The playout and the clips are the same for every listener, so they are served from the CDN's
 * shared cache; a signed-in check on each request would defeat that (it is a database call). So the
 * membership check happens once, in /api/chat/radio/listen, which hands a Gainers member a
 * short-lived listening key. The key sits in the playout address, and the playout carries a signed
 * address for each clip. The other two routes only check those signatures, which is arithmetic.
 */

/** A listening key is the same for every member for this long, so they share one cached playout. */
export const RADIO_KEY_WINDOW_MS = 15 * 60_000;
/** Members renew after the window turns, each at a moment of their own inside this spread. */
const RADIO_KEY_RENEW_SPREAD_MS = RADIO_KEY_WINDOW_MS - 2 * 60_000;
/** The relay rewrites the playout every few seconds; older than this, it has stopped. */
export const RADIO_RELAY_SILENT_MS = 5 * 60_000;
/** Larger clips cannot be kept by the CDN, so every play would pull them from the database. */
export const RADIO_CLIP_MAX_BYTES = 8 * 1024 * 1024;

const RELAY_AUDIO_PREFIX = "/api/squawkbox/relay-audio/";
const CLIP_ROOTS = new Set(["audio-cache", "sounds"]);

/** A key of the radio's own, derived from a server-only secret this deployment already has. */
function signingKey() {
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return base ? createHmac("sha256", base).update("longboard-chat-radio-v1").digest() : null;
}
function sign(text: string) {
  const key = signingKey();
  return key ? createHmac("sha256", key).update(text).digest("base64url") : null;
}
function matches(given: string, expected: string | null) {
  if (!expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
const keyWindow = (now: number) => Math.floor(now / RADIO_KEY_WINDOW_MS);

export function radioListenKey(now = Date.now()) {
  return sign(`listen:${keyWindow(now)}`);
}
/** The current key, and the one before it so a listener is never cut off as the window turns. */
export function validRadioListenKey(key: string, now = Date.now()) {
  return matches(key, sign(`listen:${keyWindow(now)}`)) || matches(key, sign(`listen:${keyWindow(now) - 1}`));
}
/**
 * When a listener should ask for the next key, as waits (a device's clock may be wrong). Each
 * listener gets a different moment so a full room never checks its membership all at once.
 */
export function radioKeyTiming(now = Date.now(), random: () => number = Math.random) {
  const turnsIn = (keyWindow(now) + 1) * RADIO_KEY_WINDOW_MS - now;
  return {
    refreshInMs: turnsIn + 5_000 + Math.floor(random() * RADIO_KEY_RENEW_SPREAD_MS),
    expiresInMs: turnsIn + RADIO_KEY_WINDOW_MS,
  };
}

/** Only the relay's two folders, and never a path that climbs out of them. */
export function validRadioClipPath(path: string) {
  const parts = path.split("/");
  return (
    parts.length >= 2 &&
    CLIP_ROOTS.has(parts[0]) &&
    parts.every((part) => part !== "" && part !== "." && part !== ".." && !/[\\\0]/.test(part))
  );
}
/** The relay table's path for an address the relay wrote into the playout, or null. */
export function radioClipPath(audioUrl: unknown) {
  if (typeof audioUrl !== "string" || !audioUrl.startsWith(RELAY_AUDIO_PREFIX)) return null;
  try {
    const path = audioUrl.slice(RELAY_AUDIO_PREFIX.length).split("/").map(decodeURIComponent).join("/");
    return validRadioClipPath(path) ? path : null;
  } catch {
    return null;
  }
}
/** A clip's signed address. It never changes for a clip, so the CDN can keep the clip for good. */
export function radioClipUrl(path: string) {
  const signature = sign(`clip:${path}`);
  if (!signature) return null;
  return `/api/chat/radio/audio/${signature}/${path.split("/").map(encodeURIComponent).join("/")}`;
}
export function validRadioClip(signature: string, path: string) {
  return validRadioClipPath(path) && matches(signature, sign(`clip:${path}`));
}

const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);

function radioEvent(raw: unknown): RadioEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const event = raw as Record<string, unknown>;
  const at = text(event.at);
  const type = RADIO_EVENT_TYPES.find((known) => known === event.type) as RadioEventType | undefined;
  const line = typeof event.line === "string" ? event.line : "";
  const path = radioClipPath(event.audioUrl);
  const audioUrl = path && radioClipUrl(path);
  if (!at || !type || !audioUrl || radioLineBlocked(line, type)) return null;
  return {
    at,
    type,
    line,
    audioUrl,
    symbol: text(event.symbol),
    session: text(event.session),
    sourceId: text(event.sourceId),
    sourceTime: text(event.sourceTime),
    playlistId: text(event.playlistId),
    sequenceIndex: typeof event.sequenceIndex === "number" ? event.sequenceIndex : undefined,
  };
}

export type RadioPlayoutRow = { events: unknown; generatedAt: unknown; updated_at: string | null };

/**
 * The relay's playout row as listeners get it: TraderRadio's own filter, only the squawks that have
 * a clip, only the fields the player uses, and each clip's address swapped for a signed one.
 */
export function radioPlayout(row: RadioPlayoutRow | null, now = Date.now()): RadioPlayout {
  if (!row) return { live: false, generatedAt: null, events: [] };
  const written = row.updated_at ? Date.parse(row.updated_at) : NaN;
  const events = Array.isArray(row.events) ? row.events : [];
  return {
    live: Number.isFinite(written) && now - written <= RADIO_RELAY_SILENT_MS,
    generatedAt: text(row.generatedAt) ?? null,
    events: events.flatMap((raw) => radioEvent(raw) ?? []),
  };
}
