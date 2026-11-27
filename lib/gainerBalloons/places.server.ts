import "server-only";
// #531 Gainer Balloons: the U.S. places a member can type to change the weather.
//
// The list is the U.S. Census Bureau's 2024 Gazetteer "places" file (public domain), made small by
// scripts/gainers/build-balloon-places.mjs into placesData.json: about 32,000 cities, towns and
// villages, each with its state, its middle rounded to one decimal place (about 10 km) and its land
// area. The file has no population, so places with the same name are ranked by land area.
// Server only: the list is read here and never sent to a browser; a search answers six names at most.
import data from "./placesData.json";
import { NEW_YORK } from "./weather";

export const PLACE_QUERY_MAX = 60;
export const PLACE_MATCHES_MAX = 6;

const STATE_NAMES: Readonly<Record<string, string>> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  PR: "Puerto Rico", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas",
  UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

export type Place = {
  /** Stable: the state and the folded name, "tx:austin". */
  id: string;
  /** "Austin" */
  name: string;
  /** "TX" */
  state: string;
  /** "Austin, TX" */
  label: string;
  lat: number;
  lon: number;
};
type Row = Place & { folded: string; area: number };

/** Lower case, no accents, letters and digits only: "Cañon City" and "canon city" are the same. */
export function foldPlaceText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

let rows: Row[] | null = null;
let byId: Map<string, Row> | null = null;
/** Every place, largest first. Unpacked on first use. */
function all(): Row[] {
  if (rows) return rows;
  const list: Row[] = [];
  for (const [state, packed] of Object.entries(data as Record<string, string>)) {
    for (const entry of packed.split("|")) {
      const name = entry.slice(0, -6);
      const num = (from: number) => parseInt(entry.slice(entry.length - from, entry.length - from + 2), 36);
      const folded = foldPlaceText(name);
      const west = (num(2) - 1900) / 10;
      list.push({
        id: `${state.toLowerCase()}:${folded}`,
        name,
        state,
        label: `${name}, ${state}`,
        lat: num(4) / 10,
        // A place past the date line is stored counted on west.
        lon: west < -180 ? Math.round((west + 360) * 10) / 10 : west,
        folded,
        area: num(6),
      });
    }
  }
  list.sort((a, b) => b.area - a.area || a.label.localeCompare(b.label, "en"));
  byId = new Map(list.map((row) => [row.id, row]));
  rows = list;
  return list;
}

const open = ({ id, name, state, label, lat, lon }: Row): Place => ({ id, name, state, label, lat, lon });

/** The place with this id, or null. */
export function placeById(id: unknown): Place | null {
  if (typeof id !== "string" || id.length > PLACE_QUERY_MAX + 3 || !/^[a-z]{2}:[a-z0-9 ]+$/.test(id)) return null;
  all();
  const row = byId!.get(id);
  return row ? open(row) : null;
}

/** New York, NY: choosing it is simply the default again. */
export function isDefaultPlace(place: Place): boolean {
  return place.state === "NY" && place.name === NEW_YORK.place;
}

/** States a typed word could mean: "tx", "texas"; with `prefix`, also "te" or "t". */
function statesFor(text: string, prefix: boolean): string[] {
  if (!text) return [];
  return Object.entries(STATE_NAMES)
    .filter(([code, name]) => {
      const short = code.toLowerCase();
      const long = foldPlaceText(name);
      return prefix ? short.startsWith(text) || long.startsWith(text) : short === text || long === text;
    })
    .map(([code]) => code);
}

/** Places whose name is the text (`exact`), or starts with it, or has a word starting with it; largest first. */
function named(text: string, states: readonly string[] | null, how: "exact" | "starts"): Row[] {
  if (!text) return [];
  const within = states ? new Set(states) : null;
  const first: Row[] = [];
  const then: Row[] = [];
  const later: Row[] = [];
  for (const row of all()) {
    if (within && !within.has(row.state)) continue;
    if (row.folded === text) first.push(row);
    else if (how === "exact") continue;
    else if (row.folded.startsWith(text)) then.push(row);
    else if (row.folded.includes(` ${text}`)) later.push(row);
  }
  return [...first, ...then, ...later];
}

/**
 * Up to six places for what was typed: "Austin", "austin tx", "Austin, TX", "Portland, Maine",
 * "new york". Names that are exactly the text come first, then names starting with it, then names
 * with a word starting with it; within each, the largest place first. Nothing for under two
 * letters or over 60 characters.
 */
export function searchPlaces(typed: unknown, limit = PLACE_MATCHES_MAX): Place[] {
  if (typeof typed !== "string" || typed.length > PLACE_QUERY_MAX) return [];
  const whole = foldPlaceText(typed);
  if (whole.length < 2) return [];
  const found: Row[] = [];
  const comma = typed.lastIndexOf(",");
  if (comma >= 0) {
    // "Austin, TX", "Portland, Ma" (still typing the state), "Austin," (no state yet).
    const name = foldPlaceText(typed.slice(0, comma));
    const state = foldPlaceText(typed.slice(comma + 1));
    const states = state ? statesFor(state, true) : null;
    if (!states || states.length) found.push(...named(name, states, "starts"));
    // A comma that is part of the name ("Islamorada, Village of Islands").
    found.push(...named(whole, null, "starts"));
  } else {
    const words = whole.split(" ");
    // "austin tx", "portland maine", "albany new york": the last one to three words as a state.
    const withState: { name: string; states: string[] }[] = [];
    for (let n = 1; n <= 3 && n < words.length; n++) {
      const states = statesFor(words.slice(-n).join(" "), false);
      if (states.length) withState.push({ name: words.slice(0, -n).join(" "), states });
    }
    for (const { name, states } of withState) found.push(...named(name, states, "exact"));
    found.push(...named(whole, null, "starts"));
    for (const { name, states } of withState) found.push(...named(name, states, "starts"));
    // "austin t": the state still being typed.
    if (words.length > 1) {
      const states = statesFor(words[words.length - 1], true);
      if (states.length) found.push(...named(words.slice(0, -1).join(" "), states, "starts"));
    }
  }
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const row of found) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(open(row));
    if (out.length >= limit) break;
  }
  return out;
}

// --- A small per-member limit: typing a name is a handful of searches, not hundreds.
export const PLACE_SEARCH_LIMIT = 60;
export const PLACE_SEARCH_WINDOW_MS = 60_000;
const asked = new Map<string, number[]>();

/** True when this member may search again now (and counts the search). */
export function placeSearchAllowed(memberKey: string, now = Date.now()): boolean {
  const recent = (asked.get(memberKey) ?? []).filter((at) => now - at < PLACE_SEARCH_WINDOW_MS);
  if (recent.length >= PLACE_SEARCH_LIMIT) {
    asked.set(memberKey, recent);
    return false;
  }
  recent.push(now);
  asked.set(memberKey, recent);
  if (asked.size > 20_000) for (const [key, times] of asked) if (!times.some((at) => now - at < PLACE_SEARCH_WINDOW_MS)) asked.delete(key);
  return true;
}

/** For tests. */
export function resetPlaceSearch() {
  asked.clear();
}
