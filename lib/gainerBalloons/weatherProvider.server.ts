// #528 Gainer Balloons: where the weather comes from. This file is the only one that knows the
// provider; swap it for another by keeping currentWeather()'s shape.
//
// Provider: the U.S. National Weather Service API (api.weather.gov). No key, no account, no fee; it
// asks only for a User-Agent naming the application, and covers the United States. A place it
// doesn't cover answers "unsupported", and the caller shows New York instead.
// Three reads for a new place, then one per refresh:
//   /points/{lat},{lon}                 the nearest town, its time zone (#532, for the clock), the stations list and the hourly forecast (kept a day)
//   <stations list>                     the nearest station (kept a day, with the above)
//   /stations/{id}/observations/latest  temperature, sky and weather in plain words
// and, only when the station has no temperature or no description, the hourly forecast's current hour.
// Nothing about the member goes with these requests: no cookie, no id, only the rounded place.
import { CONDITION_CLOUD, cloudFromLayers, conditionFromText, type WeatherCondition } from "./weather";

const HOST = "https://api.weather.gov";
/** A generic application name, as the service asks for. No personal details. */
const USER_AGENT = "GainerBalloons/1.0 (weather readout for a market visualization)";
export const UPSTREAM_TIMEOUT_MS = 4_000;
const PLACE_TTL_MS = 24 * 3_600_000;

export type ProviderWeather = {
  condition: WeatherCondition;
  cloud: number;
  tempC: number | null;
  night: boolean;
  place: string | null;
  /** The place's time zone ("America/Chicago"), or null when the answer had none. */
  zone: string | null;
};
export type ProviderResult = { ok: true; weather: ProviderWeather } | { ok: false; reason: "unsupported" | "unavailable" };

type Place = { at: number; station: string | null; hourly: string | null; place: string | null; zone: string | null };
const places = new Map<string, Place>();

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (value && typeof value === "object" ? (value as Json) : {});
const str = (value: unknown) => (typeof value === "string" ? value : "");
const finite = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
/** Only this provider's own addresses are ever followed. */
const ownAddress = (value: unknown) => (typeof value === "string" && value.startsWith(`${HOST}/`) ? value : null);

async function get(url: string): Promise<{ status: number; body: Json }> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/geo+json" },
    cache: "no-store",
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  return { status: response.status, body: response.ok ? obj(await response.json().catch(() => null)) : {} };
}

async function placeFor(key: string, lat: number, lon: number): Promise<Place | "unsupported" | null> {
  const held = places.get(key);
  if (held && Date.now() - held.at < PLACE_TTL_MS) return held;
  const point = await get(`${HOST}/points/${lat.toFixed(1)},${lon.toFixed(1)}`);
  // Outside the United States (or at sea): the service has no forecast office for it.
  if (point.status === 404 || point.status === 400) return "unsupported";
  if (point.status !== 200) return null;
  const props = obj(point.body.properties);
  const where = obj(obj(props.relativeLocation).properties);
  const stationsUrl = ownAddress(props.observationStations);
  let station: string | null = null;
  if (stationsUrl) {
    const stations = await get(stationsUrl);
    const first = Array.isArray(stations.body.features) ? obj(obj(stations.body.features[0]).properties) : {};
    const id = str(first.stationIdentifier);
    station = /^[A-Z0-9]{3,8}$/.test(id) ? id : null;
  }
  const town = str(where.city).trim().slice(0, 40);
  const zone = str(props.timeZone);
  const place: Place = {
    at: Date.now(),
    station,
    hourly: ownAddress(props.forecastHourly),
    place: town || null,
    zone: zone.length <= 40 && /^[A-Za-z]+\/[A-Za-z0-9_+\-/]+$/.test(zone) ? zone : null,
  };
  if (places.size > 5_000) places.clear();
  places.set(key, place);
  return place;
}

/** What a station's latest observation says. */
export function weatherFromObservation(properties: unknown): { condition: WeatherCondition | null; cloud: number | null; tempC: number | null; night: boolean | null } {
  const p = obj(properties);
  const present = Array.isArray(p.presentWeather) ? p.presentWeather.map((w) => `${str(obj(w).intensity)} ${str(obj(w).weather)}`).join(" ") : "";
  const layers = Array.isArray(p.cloudLayers) ? p.cloudLayers.map((layer) => str(obj(layer).amount)) : [];
  const icon = str(p.icon);
  return {
    condition: conditionFromText(`${str(p.textDescription)} ${present}`),
    cloud: cloudFromLayers(layers),
    tempC: finite(obj(p.temperature).value),
    night: icon ? icon.includes("/night/") : null,
  };
}

/** What the hourly forecast's current hour says (its temperature is in °F unless it says otherwise). */
export function weatherFromForecastHour(period: unknown): { condition: WeatherCondition | null; tempC: number | null; night: boolean | null } {
  const p = obj(period);
  const temp = finite(p.temperature);
  const unit = str(p.temperatureUnit).toUpperCase();
  return {
    condition: conditionFromText(str(p.shortForecast)),
    tempC: temp === null ? null : unit === "C" ? temp : ((temp - 32) * 5) / 9,
    night: typeof p.isDaytime === "boolean" ? !p.isDaytime : null,
  };
}

/** Current conditions for a rounded place. Never throws. */
export async function currentWeather(coords: { lat: number; lon: number }, key: string): Promise<ProviderResult> {
  try {
    const place = await placeFor(key, coords.lat, coords.lon);
    if (place === "unsupported") return { ok: false, reason: "unsupported" };
    if (!place) return { ok: false, reason: "unavailable" };
    let observed: ReturnType<typeof weatherFromObservation> = { condition: null, cloud: null, tempC: null, night: null };
    if (place.station) {
      const latest = await get(`${HOST}/stations/${place.station}/observations/latest`).catch(() => null);
      if (latest?.status === 200) observed = weatherFromObservation(latest.body.properties);
    }
    let condition = observed.condition;
    let tempC = observed.tempC;
    let night = observed.night;
    if ((condition === null || tempC === null) && place.hourly) {
      const hourly = await get(place.hourly).catch(() => null);
      const periods = hourly?.status === 200 ? obj(hourly.body.properties).periods : null;
      if (Array.isArray(periods) && periods.length) {
        const hour = weatherFromForecastHour(periods[0]);
        condition ??= hour.condition;
        tempC ??= hour.tempC;
        night ??= hour.night;
      }
    }
    // Sky cover alone still says something when no words came with it.
    if (condition === null && observed.cloud !== null) condition = observed.cloud >= 0.7 ? "cloudy" : observed.cloud >= 0.3 ? "partly" : "clear";
    if (condition === null) return { ok: false, reason: "unavailable" };
    const cloud = condition === "clear" || condition === "partly" || condition === "cloudy" ? (observed.cloud ?? CONDITION_CLOUD[condition]) : Math.max(observed.cloud ?? 0, CONDITION_CLOUD[condition]);
    return { ok: true, weather: { condition, cloud, tempC, night: night ?? false, place: place.place, zone: place.zone } };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** For tests. */
export function resetWeatherProvider() {
  places.clear();
}
