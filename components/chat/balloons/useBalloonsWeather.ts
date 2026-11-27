"use client";
// #528 Gainer Balloons: the weather behind the balloons, for this viewer.
//  - Everyone starts with New York's weather. Nothing about location is asked for on its own.
//  - "Change weather" (a link in the full app only, never a card) opens a small panel. Typing a
//    city there (#531) searches this site's own list of U.S. places and shows that place's weather;
//    the place the member chose (its id and name, nothing else) is remembered on this device, and a
//    card uses it too.
//  - "Use my location" in that panel asks the browser for the viewer's location. The position is rounded to one decimal place (about 10 km) here, before
//    anything is sent; only the rounded numbers go to this site's own route, in the request body.
//    They are kept in this page's memory only: never in storage, never in an address.
//    That position is never stored: only the choice ("local" or not) is.
//  - The choice and the °F/°C choice are remembered on this device. On a later
//    visit (and in a card) local weather is used only when the browser already has permission, so
//    nothing ever prompts without a tap.
//  - Declined, unavailable, outside the covered area, or any failure: New York's weather, or the
//    plain time-of-day sky when even that can't be read. The scene never waits on any of this.
import { useCallback, useEffect, useRef, useState } from "react";
import { defaultTempUnit, parseCoords, type TempUnit, type WeatherNow } from "@/lib/gainerBalloons/weather";

const STORE = "rb-balloons-weather-v1";
export const WEATHER_REFRESH_MS = 15 * 60_000;

/** A place chosen by typing its name: "tx:austin", "Austin", "Austin, TX". */
export type ChosenPlace = { id: string; name: string; label?: string };
type Saved = { local?: boolean; unit?: TempUnit; place?: ChosenPlace };
function chosenPlace(value: unknown): ChosenPlace | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { id, name } = value as { id?: unknown; name?: unknown };
  if (typeof id !== "string" || typeof name !== "string" || !id || !name || id.length > 80 || name.length > 80) return undefined;
  return { id, name };
}
function readSaved(): Saved {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORE) || "null");
    if (!value || typeof value !== "object") return {};
    const { local, unit, place } = value as Saved;
    // Local weather and a typed place are one choice: never both.
    return { local: local === true, unit: unit === "F" || unit === "C" ? unit : undefined, place: local === true ? undefined : chosenPlace(place) };
  } catch {
    return {};
  }
}
function save(next: Saved) {
  try {
    localStorage.setItem(STORE, JSON.stringify({ ...readSaved(), ...next }));
  } catch {
    // Storage is off: the choice lasts for this visit.
  }
}

type Place = { lat: number; lon: number };
type LocateResult = { place: Place } | { failed: "denied" | "unavailable" };

function locate(): Promise<LocateResult> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve({ failed: "unavailable" });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        // Rounded here, before anything leaves the browser.
        const place = parseCoords(position.coords.latitude, position.coords.longitude);
        resolve(place ? { place } : { failed: "unavailable" });
      },
      (error) => resolve({ failed: error.code === error.PERMISSION_DENIED ? "denied" : "unavailable" }),
      { enableHighAccuracy: false, maximumAge: 30 * 60_000, timeout: 10_000 },
    );
  });
}

/** True only when the browser will answer without asking the viewer. */
async function alreadyAllowed(): Promise<boolean> {
  try {
    if (!navigator.geolocation || !navigator.permissions?.query) return false;
    return (await navigator.permissions.query({ name: "geolocation" })).state === "granted";
  } catch {
    return false;
  }
}

/** What the weather route is asked for: a rounded position, a chosen place's id, or (null) New York. */
type Where = Place | { place: string };

/** Up to six U.S. places for what was typed. Null when the search couldn't be made. */
export async function searchWeatherPlaces(q: string, signal?: AbortSignal): Promise<ChosenPlace[] | null> {
  try {
    const response = await fetch("/api/chat/balloons/places", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q }),
      cache: "no-store",
      signal,
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { places?: unknown };
    if (!Array.isArray(body.places)) return null;
    return body.places.flatMap((entry) => {
      const place = chosenPlace(entry);
      const label = (entry as { label?: unknown } | null)?.label;
      return place ? [{ ...place, label: typeof label === "string" ? label : place.name }] : [];
    });
  } catch {
    return null;
  }
}

async function readWeather(
  place: Where | null,
  signal: AbortSignal,
): Promise<{ weather: WeatherNow | null; covered: boolean }> {
  try {
    const response = await fetch("/api/chat/balloons/weather", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(place ?? {}),
      cache: "no-store",
      signal,
    });
    if (!response.ok) return { weather: null, covered: true };
    const body = (await response.json()) as { weather?: WeatherNow | null; covered?: boolean };
    return { weather: body.weather ?? null, covered: body.covered !== false };
  } catch {
    return { weather: null, covered: true };
  }
}

export type BalloonsWeather = {
  weather: WeatherNow | null;
  unit: TempUnit;
  toggleUnit: () => void;
  /** The viewer chose local weather on this device. */
  local: boolean;
  /** One short line after a choice didn't work out (declined, unavailable, not covered). */
  note: string;
  /** Asks the browser for the location. Call only from a tap. */
  chooseLocal: () => void;
  /** Shows the weather of a place the viewer picked by typing its name, and remembers it. */
  choosePlace: (place: ChosenPlace) => void;
};

export function useBalloonsWeather(active: boolean): BalloonsWeather {
  const [weather, setWeather] = useState<WeatherNow | null>(null);
  const [unit, setUnit] = useState<TempUnit>("F");
  const [local, setLocal] = useState(false);
  const [note, setNote] = useState("");
  const place = useRef<Place | null>(null);
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(async (where: Where | null, name?: string) => {
    controller.current?.abort();
    const mine = (controller.current = new AbortController());
    const answer = await readWeather(where, mine.signal);
    if (mine.signal.aborted) return;
    // A failed refresh keeps the weather already showing.
    setWeather((before) => answer.weather ?? before);
    if (where && !answer.covered)
      setNote(
        name
          ? `Weather isn’t available for ${name} yet. Showing New York.`
          : "Local weather isn’t available where you are yet. Showing New York.",
      );
  }, []);

  useEffect(() => {
    const saved = readSaved();
    setUnit(saved.unit ?? defaultTempUnit(typeof navigator === "undefined" ? null : navigator.language));
    setLocal(!!saved.local);
  }, []);

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const refresh = async () => {
      if (readSaved().local && !place.current && (await alreadyAllowed())) {
        const found = await locate();
        if (stopped) return;
        if ("place" in found) place.current = found.place;
      }
      if (stopped) return;
      const saved = readSaved();
      if (saved.place) void load({ place: saved.place.id }, saved.place.name);
      else void load(saved.local ? place.current : null);
    };
    // Started a moment later, so an effect that is set up and torn down at once sends nothing.
    const first = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), WEATHER_REFRESH_MS);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(timer);
      controller.current?.abort();
    };
  }, [active, load]);

  const toggleUnit = useCallback(() => {
    setUnit((before) => {
      const next = before === "F" ? "C" : "F";
      save({ unit: next });
      return next;
    });
  }, []);

  const chooseLocal = useCallback(() => {
    setNote("");
    void locate().then((found) => {
      if ("failed" in found) {
        // Whatever was showing stays: New York, or the place typed earlier.
        const showing = readSaved().place?.name ?? "New York";
        setNote(
          found.failed === "denied"
            ? `Location is turned off for this site in your browser. Showing ${showing}.`
            : `Your location isn’t available right now. Showing ${showing}.`,
        );
        return;
      }
      place.current = found.place;
      // Only the choice is stored, never the position; a typed place is forgotten.
      save({ local: true, place: undefined });
      setLocal(true);
      void load(found.place);
    });
  }, [load]);

  const choosePlace = useCallback(
    (chosen: ChosenPlace) => {
      setNote("");
      place.current = null;
      setLocal(false);
      // New York, NY is the default: nothing to remember.
      const newYork = chosen.id === "ny:new york";
      save({ local: false, place: newYork ? undefined : { id: chosen.id, name: chosen.name } });
      if (newYork) void load(null);
      else void load({ place: chosen.id }, chosen.name);
    },
    [load],
  );

  return { weather, unit, toggleUnit, local, note, chooseLocal, choosePlace };
}
