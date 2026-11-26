// #528 Gainer Balloons: the weather behind the balloons. Shared by the browser and the server:
// what a reading looks like, how a place is rounded before it leaves the browser, how a plain
// description becomes one of eight conditions, and how the sky reads each condition.
// Pure: no network, no DOM.

export const WEATHER_CONDITIONS = ["clear", "partly", "cloudy", "fog", "drizzle", "rain", "snow", "thunder"] as const;
export type WeatherCondition = (typeof WEATHER_CONDITIONS)[number];

export type WeatherNow = {
  condition: WeatherCondition;
  /** Share of the sky covered, 0 (clear) to 1 (overcast). */
  cloud: number;
  /** Null when the reading has no temperature: the readout shows a dash. */
  tempC: number | null;
  /** Night where the reading was taken (the icon's moon). The scene's own light follows New York. */
  night: boolean;
  /** A town's name when the reading came with one, else null. */
  place: string | null;
  /** True for the viewer's own area; false for New York (the default). */
  local: boolean;
};

/** New York, where the market is: the weather shown to anyone who hasn't shared a location. */
export const NEW_YORK = { lat: 40.7, lon: -74.0, place: "New York" } as const;

/** One decimal place: a square about 10 km across. The browser rounds BEFORE sending anything. */
export function roundCoord(value: number): number {
  return Math.round(value * 10) / 10;
}

/** A latitude and longitude that can be looked up, rounded to one decimal place; null for anything else. */
export function parseCoords(lat: unknown, lon: unknown): { lat: number; lon: number } | null {
  if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  // "+ 0" turns a rounded -0 into 0, so one cell has one key.
  return { lat: roundCoord(lat) + 0, lon: roundCoord(lon) + 0 };
}

/** The cache key of a rounded cell: "40.7,-74.0". */
export function cellKey(coords: { lat: number; lon: number }): string {
  return `${coords.lat.toFixed(1)},${coords.lon.toFixed(1)}`;
}

/** Sky cover each condition stands for when the reading gives no cover of its own. */
export const CONDITION_CLOUD: Readonly<Record<WeatherCondition, number>> = {
  clear: 0.05,
  partly: 0.4,
  cloudy: 0.85,
  fog: 0.8,
  drizzle: 0.85,
  rain: 0.95,
  snow: 0.95,
  thunder: 1,
};

/**
 * A plain-words description ("Light Rain and Fog/Mist", "Mostly Cloudy", "Thunderstorms in
 * Vicinity") as one of the eight conditions. The worst weather named wins. Nothing recognisable: null.
 */
export function conditionFromText(text: string | null | undefined): WeatherCondition | null {
  const t = (text ?? "").toLowerCase();
  if (!t.trim()) return null;
  if (/thunder|t-?storm|lightning|tornado|funnel|squall/.test(t)) return "thunder";
  if (/snow|sleet|flurr|blizzard|wintry|ice pellet|ice crystal|freezing rain|freezing drizzle|hail/.test(t)) return "snow";
  if (/drizzle|sprinkle/.test(t)) return "drizzle";
  if (/rain|shower|downpour/.test(t)) return /light|slight|chance|isolated/.test(t) && !/heavy/.test(t) ? "drizzle" : "rain";
  if (/fog|mist|haze|smoke|dust|sand|ash/.test(t)) return "fog";
  if (/overcast|mostly cloudy|considerable cloud|broken/.test(t)) return "cloudy";
  if (/partly|mostly sunny|mostly clear|scattered|few clouds|a few|partial/.test(t)) return "partly";
  if (/cloud/.test(t)) return "cloudy";
  if (/clear|sunny|fair|fine/.test(t)) return "clear";
  return null;
}

/** Sky cover from a station's cloud layer codes (the most covered layer), or null without any. */
export function cloudFromLayers(amounts: readonly (string | null | undefined)[]): number | null {
  const cover: Record<string, number> = { SKC: 0, CLR: 0, FEW: 0.2, SCT: 0.45, BKN: 0.75, OVC: 1, VV: 1 };
  let best: number | null = null;
  for (const amount of amounts) {
    const value = cover[String(amount ?? "").toUpperCase()];
    if (value !== undefined) best = Math.max(best ?? 0, value);
  }
  return best;
}

export type TempUnit = "F" | "C";

/** Fahrenheit where people use it (the U.S. and a few neighbours), Celsius everywhere else. */
export function defaultTempUnit(locale: string | null | undefined): TempUnit {
  const region = /[-_]([A-Za-z]{2})\b/.exec(locale ?? "")?.[1]?.toUpperCase();
  if (region) return ["US", "BS", "KY", "LR", "PW", "FM", "MH", "PR", "GU", "VI"].includes(region) ? "F" : "C";
  // A bare "en" is most often a U.S. browser.
  return (locale ?? "").toLowerCase() === "en" ? "F" : "C";
}

/** "72°F", "22°C", or a dash without a temperature. */
export function formatTemp(tempC: number | null | undefined, unit: TempUnit): string {
  if (tempC == null || !Number.isFinite(tempC)) return "—";
  return `${Math.round(unit === "F" ? (tempC * 9) / 5 + 32 : tempC)}°${unit}`;
}

export const CONDITION_LABELS: Readonly<Record<WeatherCondition, string>> = {
  clear: "Clear",
  partly: "Partly cloudy",
  cloudy: "Cloudy",
  fog: "Fog",
  drizzle: "Drizzle",
  rain: "Rain",
  snow: "Snow",
  thunder: "Thunderstorm",
};

/** How the scene draws a reading. All 0..1 except fogDensity (the scene's fog) and particles. */
export type SkyWeather = {
  /** Cloud layers' cover, and how far the sky's colour is pulled to grey. */
  cloud: number;
  /** How much the sun is dimmed and the light flattened. */
  dim: number;
  fogDensity: number;
  rain: number;
  snow: number;
  thunder: boolean;
};

/** The plain time-of-day sky: what the scene shows without a reading. */
export const PLAIN_SKY: SkyWeather = { cloud: 0, dim: 0, fogDensity: 0.0086, rain: 0, snow: 0, thunder: false };

export function skyWeather(weather: WeatherNow | null | undefined): SkyWeather {
  if (!weather) return PLAIN_SKY;
  const cloud = Math.min(1, Math.max(0, Number.isFinite(weather.cloud) ? weather.cloud : CONDITION_CLOUD[weather.condition]));
  const base: SkyWeather = { cloud, dim: cloud * 0.7, fogDensity: 0.0086 + cloud * 0.002, rain: 0, snow: 0, thunder: false };
  switch (weather.condition) {
    case "fog":
      return { ...base, cloud: Math.max(cloud, 0.7), dim: 0.6, fogDensity: 0.021 };
    case "drizzle":
      return { ...base, cloud: Math.max(cloud, 0.8), dim: 0.65, fogDensity: 0.0115, rain: 0.4 };
    case "rain":
      return { ...base, cloud: Math.max(cloud, 0.9), dim: 0.8, fogDensity: 0.013, rain: 1 };
    case "snow":
      return { ...base, cloud: Math.max(cloud, 0.9), dim: 0.6, fogDensity: 0.0135, snow: 1 };
    case "thunder":
      return { ...base, cloud: 1, dim: 0.9, fogDensity: 0.013, rain: 1, thunder: true };
    default:
      return base;
  }
}
