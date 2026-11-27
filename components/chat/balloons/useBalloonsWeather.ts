"use client";
// #528 Gainer Balloons: the weather behind the balloons, for this viewer.
//  - Everyone starts with New York's weather. Nothing about location is asked for on its own.
//  - "Use my local weather" (a button in the full app only, never a card) asks the browser for the
//    viewer's location. The position is rounded to one decimal place (about 10 km) here, before
//    anything is sent; only the rounded numbers go to this site's own route, in the request body.
//    They are kept in this page's memory only: never in storage, never in an address.
//  - The choice ("local" or not) and the °F/°C choice are remembered on this device. On a later
//    visit (and in a card) local weather is used only when the browser already has permission, so
//    nothing ever prompts without a tap.
//  - Declined, unavailable, outside the covered area, or any failure: New York's weather, or the
//    plain time-of-day sky when even that can't be read. The scene never waits on any of this.
import { useCallback, useEffect, useRef, useState } from "react";
import { defaultTempUnit, parseCoords, type TempUnit, type WeatherNow } from "@/lib/gainerBalloons/weather";

const STORE = "rb-balloons-weather-v1";
export const WEATHER_REFRESH_MS = 15 * 60_000;

type Saved = { local?: boolean; unit?: TempUnit };
function readSaved(): Saved {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORE) || "null");
    if (!value || typeof value !== "object") return {};
    const { local, unit } = value as Saved;
    return { local: local === true, unit: unit === "F" || unit === "C" ? unit : undefined };
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

async function readWeather(
  place: Place | null,
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
};

export function useBalloonsWeather(active: boolean): BalloonsWeather {
  const [weather, setWeather] = useState<WeatherNow | null>(null);
  const [unit, setUnit] = useState<TempUnit>("F");
  const [local, setLocal] = useState(false);
  const [note, setNote] = useState("");
  const place = useRef<Place | null>(null);
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(async (where: Place | null) => {
    controller.current?.abort();
    const mine = (controller.current = new AbortController());
    const answer = await readWeather(where, mine.signal);
    if (mine.signal.aborted) return;
    // A failed refresh keeps the weather already showing.
    setWeather((before) => answer.weather ?? before);
    if (where && !answer.covered)
      setNote("Local weather isn’t available where you are yet. Showing New York.");
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
      if (!stopped) void load(readSaved().local ? place.current : null);
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
        setNote(
          found.failed === "denied"
            ? "Location is turned off for this site in your browser. Showing New York."
            : "Your location isn’t available right now. Showing New York.",
        );
        return;
      }
      place.current = found.place;
      save({ local: true });
      setLocal(true);
      void load(found.place);
    });
  }, [load]);

  return { weather, unit, toggleUnit, local, note, chooseLocal };
}
