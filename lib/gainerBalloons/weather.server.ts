// #528 Gainer Balloons: the weather route's memory. One reading per rounded place (about 10 km) is
// kept for 15 minutes for everyone on this server, so many viewers in one area cost one upstream
// read; New York, the default, is kept the same way. A failed read is kept for 2 minutes so a
// provider that is down is not asked again by every viewer. Nothing here is written anywhere: the
// place is a key in this server's memory until it expires, never a log line or a database row, and
// it is never tied to the member who asked.
import { cellKey, NEW_YORK, type WeatherNow } from "./weather";
import { currentWeather, type ProviderResult } from "./weatherProvider.server";

export const WEATHER_TTL_MS = 15 * 60_000;
export const WEATHER_FAILED_TTL_MS = 2 * 60_000;
const MAX_CELLS = 5_000;

/** `readAt`: when the reading was taken. `until`: when this place is asked for again. */
type Entry = { readAt: number; until: number; result: ProviderResult };
const cache = new Map<string, Entry>();
const pending = new Map<string, Promise<ProviderResult>>();

async function cell(coords: { lat: number; lon: number }, now: number): Promise<ProviderResult> {
  const key = cellKey(coords);
  const held = cache.get(key);
  if (held && now < held.until) return held.result;
  let read = pending.get(key);
  if (!read) {
    read = currentWeather(coords, key)
      .then((result) => {
        const at = Date.now();
        if (cache.size >= MAX_CELLS) for (const [k, e] of cache) if (at >= e.until) cache.delete(k);
        if (cache.size >= MAX_CELLS) cache.clear();
        // A passing failure doesn't replace a reading under an hour old; either way it is asked for again in 2 minutes.
        if (!result.ok && result.reason === "unavailable") {
          const keep = held?.result.ok && at - held.readAt < 4 * WEATHER_TTL_MS ? held : null;
          cache.set(key, { readAt: keep?.readAt ?? at, until: at + WEATHER_FAILED_TTL_MS, result: keep?.result ?? result });
          return keep?.result ?? result;
        }
        cache.set(key, { readAt: at, until: at + WEATHER_TTL_MS, result });
        return result;
      })
      .finally(() => pending.delete(key));
    pending.set(key, read);
  }
  return read;
}

/**
 * The weather to show: the viewer's own area when a place is given and the provider covers it,
 * otherwise New York's. `covered` is false when a place was given but isn't covered. Null when
 * nothing could be read: the page then keeps its plain time-of-day sky. `name` (#531): the name of
 * a place the member chose by typing it, shown instead of the nearest town the reading came with.
 */
export async function weatherFor(coords: { lat: number; lon: number } | null, now = Date.now(), name?: string): Promise<{ weather: WeatherNow | null; covered: boolean }> {
  let covered = true;
  if (coords) {
    const local = await cell(coords, now);
    if (local.ok) return { weather: { ...local.weather, place: name ?? local.weather.place, local: true }, covered: true };
    covered = local.reason !== "unsupported";
  }
  const newYork = await cell(NEW_YORK, now);
  return { weather: newYork.ok ? { ...newYork.weather, place: NEW_YORK.place, local: false } : null, covered };
}

// --- A small per-member limit, so one account can't walk the map through this server.
export const WEATHER_LIMIT = 20;
export const WEATHER_LIMIT_WINDOW_MS = 10 * 60_000;
const asked = new Map<string, number[]>();

/** True when this member may ask again now (and counts the ask). */
export function weatherAllowed(memberKey: string, now = Date.now()): boolean {
  const recent = (asked.get(memberKey) ?? []).filter((at) => now - at < WEATHER_LIMIT_WINDOW_MS);
  if (recent.length >= WEATHER_LIMIT) {
    asked.set(memberKey, recent);
    return false;
  }
  recent.push(now);
  asked.set(memberKey, recent);
  if (asked.size > 20_000) for (const [key, times] of asked) if (!times.some((at) => now - at < WEATHER_LIMIT_WINDOW_MS)) asked.delete(key);
  return true;
}

/** For tests. */
export function resetWeather() {
  cache.clear();
  pending.clear();
  asked.clear();
}
