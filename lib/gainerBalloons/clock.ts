// #532 Gainer Balloons: the clock follows the place whose weather is showing. The trading day never
// moves (4:00 AM to 8:00 PM in New York); only the times a member reads are written in the chosen
// place's own time, with short plain letters after them: "8:00 AM CT". Without a place, or with a
// time zone this file doesn't know, everything stays in New York time ("ET").
// Pure: no network, no DOM. Daylight saving is the browser's own (Intl), so Arizona and Hawaii,
// which don't shift, come out right in summer and in winter.
import { MARKET_HOURS } from "./config";

/** Short letters by a zone's standard (winter) hours from UTC. Arizona is "MT", Puerto Rico "AT". */
const LETTERS: Readonly<Record<number, string>> = {
  [-4]: "AT",
  [-5]: "ET",
  [-6]: "CT",
  [-7]: "MT",
  [-8]: "PT",
  [-9]: "AKT",
  [-10]: "HT",
  [-11]: "ST",
  [10]: "ChT",
};

function offsetHours(zone: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return (Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute")) - utcMs) / 3_600_000;
}

const letters = new Map<string, string | null>();
/**
 * "CT" for "America/Chicago", "MT" for "America/Phoenix", "HT" for "Pacific/Honolulu". Null for
 * anything that isn't a time zone name the browser knows, or one outside the U.S. zones above.
 */
export function zoneLetters(zone: unknown): string | null {
  if (typeof zone !== "string" || !zone || zone.length > 40 || !/^[A-Za-z]+\/[A-Za-z0-9_+\-/]+$/.test(zone)) return null;
  const held = letters.get(zone);
  if (held !== undefined) return held;
  let found: string | null = null;
  try {
    // The standard offset is the smaller of a winter and a summer day's (north of the equator).
    const standard = Math.min(offsetHours(zone, Date.UTC(2025, 0, 15, 12)), offsetHours(zone, Date.UTC(2025, 6, 15, 12)));
    found = LETTERS[standard] ?? null;
  } catch {
    found = null;
  }
  if (letters.size > 200) letters.clear();
  letters.set(zone, found);
  return found;
}

/** The zone itself when the clock can follow it, else null (the clock then stays on New York). */
export function clockZone(zone: unknown): string | null {
  return zoneLetters(zone) ? (zone as string) : null;
}

export type PlaceClock = {
  /** The IANA name. Never shown. */
  zone: string;
  /** "ET", "CT", "MT", "PT", "AKT", "HT" */
  letters: string;
  /** "8:00 AM" */
  time: (ms: number) => string;
  /** "8:00 AM CT" */
  clock: (ms: number) => string;
};

const clocks = new Map<string, PlaceClock>();
/** How times read in a place. An unknown or missing zone reads in New York time, "ET". */
export function placeClock(zone?: string | null): PlaceClock {
  const known = clockZone(zone) ?? MARKET_HOURS.timeZone;
  const held = clocks.get(known);
  if (held) return held;
  const format = new Intl.DateTimeFormat("en-US", { timeZone: known, hour: "numeric", minute: "2-digit", hour12: true });
  const short = zoneLetters(known) ?? "ET";
  // Some browsers put a narrow space before AM/PM: a plain one reads the same everywhere.
  const time = (ms: number) => format.format(new Date(ms)).replace(/[  ]/g, " ");
  const made: PlaceClock = { zone: known, letters: short, time, clock: (ms) => `${time(ms)} ${short}` };
  if (clocks.size > 200) clocks.clear();
  clocks.set(known, made);
  return made;
}
