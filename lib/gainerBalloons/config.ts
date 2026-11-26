// #528 Gainer Balloons: every number the picture is drawn from, in one place.
// Country stretch table, scales, the trading day's hours, replay speeds and the layout.
// Pure data: safe in the browser, on the server and in unit tests (no three.js, no DOM).

export type CountryTier = "china" | "non_us" | "us";

export type CountryProfile = {
  /** How far the balloon can stretch past its volume size (1.00 = U.S., the least). */
  stretchCap: number;
  /** How tall the teardrop can pull at full stretch. */
  elongationMax: number;
  /** Which wing of the field the balloon stands in. */
  tier: CountryTier;
  label: string;
  /** The latex colour of a balloon whose float is known. */
  color: string;
  /** The rim tint as the skin stretches thin. */
  strainTint: string;
};

const CHINA: Omit<CountryProfile, "color" | "strainTint"> = { stretchCap: 1.65, elongationMax: 1.38, tier: "china", label: "China / HK" };
const SMALL_CAP_HOME: Omit<CountryProfile, "color" | "strainTint"> = { stretchCap: 1.34, elongationMax: 1.24, tier: "non_us", label: "Non-U.S. small-cap" };
const SMALL_CAP_HOME_2: Omit<CountryProfile, "color" | "strainTint"> = { stretchCap: 1.26, elongationMax: 1.2, tier: "non_us", label: "Non-U.S. small-cap" };
const DEVELOPED: Omit<CountryProfile, "color" | "strainTint"> = { stretchCap: 1.14, elongationMax: 1.14, tier: "non_us", label: "Non-U.S." };

/**
 * The country stretch table. Keys are compared without case, dots or punctuation
 * (see countryKey), so "U.S.", "US" and "United States" all read as the same country.
 */
export const COUNTRY_STRETCH: Readonly<Record<string, CountryProfile>> = {
  china: { ...CHINA, color: "#d85745", strainTint: "#ffbe8a" },
  "hong kong": { ...CHINA, color: "#de6a4f", strainTint: "#ffc694" },
  "china hong kong": { ...CHINA, color: "#d96048", strainTint: "#ffc28e" },
  macau: { ...CHINA, color: "#d96048", strainTint: "#ffc28e" },
  malaysia: { ...SMALL_CAP_HOME, color: "#d89336", strainTint: "#ffe29c" },
  singapore: { ...SMALL_CAP_HOME, color: "#d29e3b", strainTint: "#ffe8a8" },
  cambodia: { ...SMALL_CAP_HOME, color: "#cc8838", strainTint: "#ffdca0" },
  israel: { ...SMALL_CAP_HOME_2, color: "#5a9c8e", strainTint: "#b8f0e2" },
  greece: { ...SMALL_CAP_HOME_2, color: "#56949e", strainTint: "#b6e8f2" },
  "united kingdom": { ...DEVELOPED, color: "#6b9485", strainTint: "#c2e8da" },
  canada: { ...DEVELOPED, color: "#638f96", strainTint: "#bde2e8" },
  germany: { ...DEVELOPED, color: "#738e9c", strainTint: "#c4deeb" },
  us: { stretchCap: 1.0, elongationMax: 1.09, tier: "us", label: "U.S.", color: "#4f7eb8", strainTint: "#b8dcff" },
};

/** A country the table doesn't list (or one not known yet): a mid non-U.S. balloon. */
export const DEFAULT_COUNTRY_PROFILE: CountryProfile = {
  stretchCap: 1.24,
  elongationMax: 1.18,
  tier: "non_us",
  label: "Non-U.S.",
  color: "#6c9596",
  strainTint: "#c5e8e8",
};

const US_KEYS = new Set(["us", "usa", "u s", "u s a", "united states", "united states of america", "america"]);

/** A country name as the table keys it: lower case, punctuation to spaces, single spaces. */
export function countryKey(country: string): string {
  return country
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();
}

export function getCountryProfile(country: string | null | undefined): CountryProfile {
  if (!country) return DEFAULT_COUNTRY_PROFILE;
  const key = countryKey(country);
  if (!key) return DEFAULT_COUNTRY_PROFILE;
  if (US_KEYS.has(key)) return COUNTRY_STRETCH.us;
  const exact = COUNTRY_STRETCH[key];
  if (exact) return exact;
  // "China (Hong Kong)", "Hong Kong SAR", "People's Republic of China"…
  if (/\bchina\b/.test(key) && /\bhong kong\b/.test(key)) return COUNTRY_STRETCH["china hong kong"];
  if (/\bhong kong\b/.test(key)) return COUNTRY_STRETCH["hong kong"];
  if (/\bchina\b/.test(key) || /\bmacau\b/.test(key) || /\bmacao\b/.test(key)) return COUNTRY_STRETCH.china;
  return DEFAULT_COUNTRY_PROFILE;
}

/** Visual mapping scales (world units). */
export const SCALES = {
  // Cumulative volume -> base balloon radius (log10 scale from 10K to 100M shares).
  volume: {
    minShares: 10_000,
    maxShares: 100_000_000,
    untradedRadius: 0.22,
    minRadius: 0.42,
    maxBaseRadius: 1.58,
    power: 1.08,
  },
  // Volume / float -> strain and stretch.
  strain: {
    onsetRotation: 0.35,
    fullFloatRotation: 1.0,
    saturationRotation: 20.0,
    unknownBaseColor: "#cfd6de",
    unknownCountryTintMix: 0.16,
  },
  // Percent price change -> height above the ground (y = 0).
  altitude: {
    zeroPctY: 4.4,
    negativeSpanY: 2.5,
    negativeFloorPct: -35,
    linearKneePct: 55,
    linearSlopeY: 0.115,
    logSlopeY: 4.8,
    minGroundClearance: 0.48,
    maxY: 22.5,
  },
  // Float -> lightness (low float = lighter, wider drift, faster reaction).
  agility: {
    minFloat: 200_000,
    maxFloat: 120_000_000,
    unknownAgility: 0.24,
    minDriftRadius: 0.14,
    maxDriftRadius: 0.88,
    minResponseRate: 3.0,
    maxResponseRate: 11.5,
  },
  // A fresh burst of volume and how long its ripple lasts.
  burst: {
    lookbackBars: 8,
    ratioThreshold: 3.0,
    minAbsoluteVolume: 45_000,
    /** The floor also rises with the day so far: this share of the volume before the bar. */
    dayShareFloor: 0.004,
    decayMs: 6 * 60_000,
    onsetMs: 24_000,
  },
  // Losing lift: the price falling back after a big run.
  liftLoss: {
    minPeakPct: 18,
    minVolumeForHeaviness: 300_000,
    fullDrawdownPct: 60,
  },
} as const;

/** The trading day (New York time, minutes since midnight). */
export const MARKET_HOURS = {
  timeZone: "America/New_York",
  dayStartMin: 4 * 60,
  regularStartMin: 9 * 60 + 30,
  regularEndMin: 16 * 60,
  dayEndMin: 20 * 60,
} as const;

/** Replay speeds (market minutes per real second). */
export const PLAYBACK_SPEEDS = [
  { id: "1m", label: "1m/s", minutesPerSec: 1 },
  { id: "5m", label: "5m/s", minutesPerSec: 5 },
  { id: "20m", label: "20m/s", minutesPerSec: 20 },
] as const;
export type PlaybackSpeedId = (typeof PLAYBACK_SPEEDS)[number]["id"];
export const DEFAULT_SPEED_ID: PlaybackSpeedId = "5m";

/** The field: three wings around an open middle. */
export const LAYOUT = {
  sectors: {
    china: { startDeg: -146, endDeg: -72, label: "CHINA / HK", subtitle: "Highest stretch" },
    non_us: { startDeg: -60, endDeg: 28, label: "NON-U.S.", subtitle: "Mid–high stretch" },
    us: { startDeg: 40, endDeg: 146, label: "UNITED STATES", subtitle: "Baseline stretch" },
  },
  innerRadius: 9.5,
  rowSpacing: 5.9,
  minAnchorSpacing: 5.5,
  zStretch: 0.86,
} as const;

/** The most stocks the picture shows at once (the server caps its list at the same number). */
export const MAX_BALLOONS = 60;
