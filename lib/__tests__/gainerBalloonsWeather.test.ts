import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// #528 Gainer Balloons: the weather behind the balloons. The condition mapping, how a place is
// rounded and keyed, input checks, the cache, the per-member limit and every way of falling back.
// The weather service is a stand-in; nothing real is read.
const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: auth }));
vi.mock("server-only", () => ({}));
import { POST } from "@/app/api/chat/balloons/weather/route";
import { CONDITION_CLOUD, NEW_YORK, PLAIN_SKY, WEATHER_CONDITIONS, cellKey, cloudFromLayers, conditionFromText, defaultTempUnit, formatTemp, parseCoords, roundCoord, skyWeather, type WeatherNow } from "@/lib/gainerBalloons/weather";
import { WEATHER_FAILED_TTL_MS, WEATHER_LIMIT, WEATHER_LIMIT_WINDOW_MS, WEATHER_TTL_MS, resetWeather, weatherAllowed, weatherFor } from "@/lib/gainerBalloons/weather.server";
import { resetWeatherProvider, weatherFromForecastHour, weatherFromObservation } from "@/lib/gainerBalloons/weatherProvider.server";
import { lightningPulse } from "@/components/chat/balloons/scene/lightning";

const member = { ok: true as const, user: { id: "22222222-2222-4222-8222-222222222222", email: "m@example.test", role: "user" as const }, access: { longboard: true, boardroom: true, shortscout: false, admin: false }, serverSession: false };
const NOW = Date.parse("2026-11-25T15:00:00Z");
const fetchMock = vi.fn();
const asked = () => fetchMock.mock.calls.map(([url]) => String(url).replace("https://api.weather.gov", ""));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

type Station = { temp?: number | null; text?: string; icon?: string; layers?: string[]; status?: number };
/** A stand-in weather service. Each place: a town, a station and what that station reports; null = not covered. */
function service(places: Record<string, (Station & { town?: string; zone?: string | null; hourly?: unknown }) | null>) {
  fetchMock.mockImplementation(async (url: unknown, init?: RequestInit) => {
    const address = String(url);
    expect(address.startsWith("https://api.weather.gov/")).toBe(true);
    expect((init?.headers as Record<string, string>)["User-Agent"]).toMatch(/^GainerBalloons\//);
    const path = address.replace("https://api.weather.gov", "");
    const point = path.match(/^\/points\/(-?\d+\.\d),(-?\d+\.\d)$/);
    if (point) {
      const place = places[`${point[1]},${point[2]}`];
      if (place === undefined) return json({}, 500);
      if (place === null) return json({ title: "Data Unavailable For Requested Point" }, 404);
      const id = `K${point[1].replace(/\D/g, "")}`;
      return json({ properties: { relativeLocation: { properties: { city: place.town ?? "Sometown", state: "NY" } }, timeZone: place.zone === undefined ? "America/New_York" : place.zone, observationStations: `https://api.weather.gov/gridpoints/XXX/1,1/stations?id=${id}&p=${point[1]},${point[2]}`, forecastHourly: `https://api.weather.gov/gridpoints/XXX/1,1/forecast/hourly?p=${point[1]},${point[2]}` } });
    }
    const where = new URL(address).searchParams.get("p") ?? "";
    if (path.startsWith("/gridpoints/XXX/1,1/stations")) return json({ features: [{ properties: { stationIdentifier: new URL(address).searchParams.get("id") } }] });
    if (path.startsWith("/gridpoints/XXX/1,1/forecast/hourly")) return places[where]?.hourly ? json({ properties: { periods: [places[where]!.hourly] } }) : json({}, 503);
    const station = path.match(/^\/stations\/(K\d+)\/observations\/latest$/);
    if (station) {
      const place = Object.entries(places).find(([key]) => `K${key.split(",")[0].replace(/\D/g, "")}` === station[1])?.[1];
      if (!place || place.status) return json({}, place?.status ?? 404);
      return json({ properties: { temperature: { value: place.temp ?? null, unitCode: "wmoUnit:degC" }, textDescription: place.text ?? "", icon: place.icon ?? "https://api.weather.gov/icons/land/day/few?size=medium", cloudLayers: (place.layers ?? []).map((amount) => ({ amount })) } });
    }
    return json({}, 404);
  });
}
const NY = "40.7,-74.0";
const post = (body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) =>
  POST(new NextRequest("https://chat.example.test/api/chat/balloons/weather", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  resetWeather();
  resetWeatherProvider();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  auth.mockResolvedValue(member);
  service({ [NY]: { town: "Hoboken", temp: 12.2, text: "Mostly Cloudy", layers: ["FEW", "BKN"] } });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("conditions", () => {
  it("reads plain descriptions as one of eight conditions, the worst weather winning", () => {
    const cases: Record<string, string | null> = {
      Clear: "clear", Sunny: "clear", Fair: "clear", "Mostly Clear": "partly", "Partly Cloudy": "partly", "A Few Clouds": "partly", "Mostly Sunny": "partly",
      "Mostly Cloudy": "cloudy", Overcast: "cloudy", Cloudy: "cloudy", "Fog/Mist": "fog", Haze: "fog", "Patchy Fog": "fog", Smoke: "fog",
      "Light Drizzle": "drizzle", "Light Rain": "drizzle", "Chance Rain Showers": "drizzle", Rain: "rain", "Heavy Rain": "rain", "Rain Showers": "rain", "Light Rain and Fog/Mist": "drizzle",
      "Light Snow": "snow", "Snow Showers": "snow", "Rain and Snow": "snow", "Freezing Rain": "snow", Sleet: "snow", "Wintry Mix": "snow", Flurries: "snow",
      Thunderstorm: "thunder", "Thunderstorms and Rain": "thunder", "Light Snow and Thunder": "thunder", "T-storms in Vicinity": "thunder",
      "": null, "   ": null, "N/A": null,
    };
    for (const [text, expected] of Object.entries(cases)) expect(conditionFromText(text), text).toBe(expected);
    expect(conditionFromText(null)).toBeNull();
    expect(conditionFromText(undefined)).toBeNull();
  });
  it("reads a station's cloud layers as sky cover (the most covered layer)", () => {
    expect(cloudFromLayers(["FEW", "BKN"])).toBe(0.75);
    expect(cloudFromLayers(["CLR"])).toBe(0);
    expect(cloudFromLayers(["ovc", "SCT"])).toBe(1);
    expect(cloudFromLayers([])).toBeNull();
    expect(cloudFromLayers([null, "??"])).toBeNull();
  });
  it("reads an observation and an hourly forecast", () => {
    expect(weatherFromObservation({ temperature: { value: -3.4 }, textDescription: "Light Snow", icon: "https://api.weather.gov/icons/land/night/snow?size=medium", cloudLayers: [{ amount: "OVC" }] })).toEqual({ condition: "snow", cloud: 1, tempC: -3.4, night: true });
    expect(weatherFromObservation({ temperature: { value: null }, textDescription: "", presentWeather: [{ intensity: "heavy", weather: "rain" }] })).toEqual({ condition: "rain", cloud: null, tempC: null, night: null });
    expect(weatherFromObservation(null)).toEqual({ condition: null, cloud: null, tempC: null, night: null });
    expect(weatherFromForecastHour({ temperature: 50, temperatureUnit: "F", shortForecast: "Partly Cloudy", isDaytime: false })).toEqual({ condition: "partly", tempC: 10, night: true });
    expect(weatherFromForecastHour({ temperature: 7, temperatureUnit: "C", shortForecast: "Sunny", isDaytime: true })).toEqual({ condition: "clear", tempC: 7, night: false });
    expect(weatherFromForecastHour("nonsense")).toEqual({ condition: null, tempC: null, night: null });
  });
  it("draws each condition differently, and nothing at all without a reading", () => {
    expect(skyWeather(null)).toBe(PLAIN_SKY);
    expect(skyWeather(undefined)).toBe(PLAIN_SKY);
    const sky = (condition: WeatherNow["condition"], cloud = CONDITION_CLOUD[condition]) => skyWeather({ condition, cloud, tempC: 10, night: false, place: null, local: false });
    expect(sky("clear")).toMatchObject({ rain: 0, snow: 0, thunder: false });
    expect(sky("clear").cloud).toBeLessThan(0.1);
    expect(sky("cloudy").cloud).toBeGreaterThan(sky("partly").cloud);
    expect(sky("cloudy").dim).toBeGreaterThan(sky("partly").dim);
    // #539: fog is mist around the field; only a little more haze over the balloons themselves.
    expect(sky("fog").mist).toBe(1);
    expect(sky("fog").fogDensity).toBeGreaterThan(sky("cloudy").fogDensity);
    for (const condition of ["clear", "partly", "cloudy", "rain", "snow", "thunder"] as const) expect(sky(condition).mist, condition).toBe(0);
    expect(sky("rain")).toMatchObject({ rain: 1, snow: 0, thunder: false });
    expect(sky("drizzle").rain).toBeLessThan(sky("rain").rain);
    expect(sky("drizzle").rain).toBeGreaterThan(0);
    expect(sky("snow")).toMatchObject({ rain: 0, snow: 1 });
    expect(sky("thunder")).toMatchObject({ rain: 1, thunder: true, cloud: 1 });
    // Rain is never drawn under a clear sky, whatever cover the reading gave.
    expect(sky("rain", 0).cloud).toBeGreaterThanOrEqual(0.9);
    for (const condition of WEATHER_CONDITIONS) {
      const s = sky(condition, Number.NaN);
      for (const value of [s.cloud, s.dim, s.fogDensity, s.mist, s.rain, s.snow]) expect(Number.isFinite(value), condition).toBe(true);
      // #539: no weather hazes the balloons much more than a clear day does (0.0086).
      expect(s.fogDensity).toBeLessThanOrEqual(0.0102);
    }
  });
  it("lets lightning glow softly, once at most every several seconds", () => {
    const starts: number[] = [];
    let last = 0;
    let peak = 0;
    for (let t = 0; t < 600; t += 0.02) {
      const value = lightningPulse(t);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
      // No strobe: the glow never jumps from one frame to the next.
      expect(Math.abs(value - last)).toBeLessThan(0.2);
      if (value > 0 && last === 0) starts.push(t);
      last = value;
      peak = Math.max(peak, value);
    }
    expect(peak).toBeGreaterThan(0.9);
    expect(starts.length).toBeGreaterThan(40);
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(6.9);
  });
});

describe("places", () => {
  it("rounds to one decimal place, about 10 km", () => {
    expect(roundCoord(41.8781)).toBe(41.9);
    expect(roundCoord(-87.6298)).toBe(-87.6);
    expect(roundCoord(40.749999)).toBe(40.7);
    expect(parseCoords(41.8781, -87.6298)).toEqual({ lat: 41.9, lon: -87.6 });
    expect(Object.is(parseCoords(-0.01, 0.01)!.lat, 0)).toBe(true);
  });
  it("gives every place in one cell the same key", () => {
    const keys = [[41.8781, -87.6298], [41.91, -87.64], [41.86, -87.56], [41.9, -87.6]].map(([lat, lon]) => cellKey(parseCoords(lat, lon)!));
    expect(new Set(keys)).toEqual(new Set(["41.9,-87.6"]));
    expect(cellKey(parseCoords(41.96, -87.6298)!)).toBe("42.0,-87.6");
    expect(cellKey(NEW_YORK)).toBe(NY);
    expect(cellKey({ lat: 5, lon: -0 })).toBe("5.0,0.0");
  });
  it("refuses anything that isn't a place on Earth", () => {
    for (const [lat, lon] of [[91, 0], [-90.1, 0], [0, 180.5], [0, -181], [Number.NaN, 0], [0, Infinity], ["41.9", "-87.6"], [null, 0], [undefined, undefined], [{}, []]]) expect(parseCoords(lat, lon), JSON.stringify([lat, lon])).toBeNull();
    expect(parseCoords(90, -180)).toEqual({ lat: 90, lon: -180 });
  });
  it("shows °F to U.S. browsers and °C to everyone else, and a dash without a temperature", () => {
    expect(["en-US", "es-US", "en", "en_US"].map(defaultTempUnit)).toEqual(["F", "F", "F", "F"]);
    expect(["en-GB", "de-DE", "fr", "en-CA", "zh-Hans-CN", "", null].map(defaultTempUnit)).toEqual(["C", "C", "C", "C", "C", "C", "C"]);
    expect([formatTemp(20, "F"), formatTemp(20, "C"), formatTemp(-3.4, "C"), formatTemp(-17.8, "F"), formatTemp(null, "F"), formatTemp(Number.NaN, "C")]).toEqual(["68°F", "20°C", "-3°C", "0°F", "—", "—"]);
  });
});

describe("weatherFor (the cache and the fallbacks)", () => {
  it("answers New York's weather to someone who shared nothing", async () => {
    expect(await weatherFor(null)).toEqual({ covered: true, weather: { condition: "cloudy", cloud: 0.75, tempC: 12.2, night: false, place: "New York", local: false, zone: "America/New_York" } });
    expect(asked()).toEqual(["/points/40.7,-74.0", "/gridpoints/XXX/1,1/stations?id=K407&p=40.7,-74.0", "/stations/K407/observations/latest"]);
  });
  it("reads one place once in 15 minutes, however many viewers are in it", async () => {
    service({ [NY]: { text: "Clear", temp: 5 }, "41.9,-87.6": { town: "Chicago", zone: "America/Chicago", text: "Light Snow", temp: -2, layers: ["OVC"], icon: "https://api.weather.gov/icons/land/night/snow" } });
    const viewers = [[41.8781, -87.6298], [41.91, -87.64], [41.86, -87.62]].map(([lat, lon]) => weatherFor(parseCoords(lat, lon)));
    const answers = await Promise.all(viewers);
    for (const answer of answers) expect(answer).toEqual({ covered: true, weather: { condition: "snow", cloud: 1, tempC: -2, night: true, place: "Chicago", local: true, zone: "America/Chicago" } });
    expect(asked()).toHaveLength(3);
    vi.setSystemTime(NOW + WEATHER_TTL_MS - 1_000);
    await weatherFor(parseCoords(41.9, -87.6));
    expect(asked()).toHaveLength(3);
    // After 15 minutes: one more read, of the station only (the town and station are kept a day).
    vi.setSystemTime(NOW + WEATHER_TTL_MS + 1_000);
    await Promise.all([weatherFor(parseCoords(41.9, -87.6)), weatherFor(parseCoords(41.88, -87.63))]);
    expect(asked()).toHaveLength(4);
    expect(asked().at(-1)).toBe("/stations/K419/observations/latest");
    // New York was never needed for them.
    expect(asked().some((path) => path.includes("40.7"))).toBe(false);
  });
  it("passes the place's time zone along for the clock, and nothing that isn't a zone name (#532)", async () => {
    service({ [NY]: { text: "Clear", temp: 5 }, "30.3,-97.8": { town: "Austin", zone: "America/Chicago", text: "Sunny", temp: 30 }, "33.4,-112.1": { town: "Phoenix", zone: "<b>America/Phoenix</b>", text: "Sunny", temp: 35 }, "21.3,-157.9": { town: "Honolulu", zone: null, text: "Sunny", temp: 28 } });
    expect((await weatherFor(parseCoords(30.3, -97.8))).weather).toMatchObject({ place: "Austin", local: true, zone: "America/Chicago" });
    expect((await weatherFor(parseCoords(33.4, -112.1))).weather).toMatchObject({ place: "Phoenix", zone: null });
    expect((await weatherFor(parseCoords(21.3, -157.9))).weather).toMatchObject({ place: "Honolulu", zone: null });
    // Kept with the reading: asked for again within 15 minutes, nothing more is read.
    const reads = asked().length;
    expect((await weatherFor(parseCoords(30.3, -97.8))).weather?.zone).toBe("America/Chicago");
    expect(asked()).toHaveLength(reads);
  });
  it("answers New York's weather, marked not covered, for a place outside the service's area", async () => {
    service({ [NY]: { text: "Clear", temp: 5 }, "51.5,-0.1": null });
    const london = await weatherFor(parseCoords(51.5074, -0.1278));
    expect(london).toEqual({ covered: false, weather: { condition: "clear", cloud: 0.05, tempC: 5, night: false, place: "New York", local: false, zone: "America/New_York" } });
    // "Not covered" is remembered for the 15 minutes too.
    await weatherFor(parseCoords(51.5, -0.1));
    expect(asked().filter((path) => path.startsWith("/points/51.5"))).toHaveLength(1);
  });
  it("fills in from the hourly forecast when the station has no temperature or description", async () => {
    service({ [NY]: { temp: null, text: "", layers: [], hourly: { temperature: 41, temperatureUnit: "F", shortForecast: "Chance Rain Showers", isDaytime: false } } });
    expect((await weatherFor(null)).weather).toEqual({ condition: "drizzle", cloud: 0.85, tempC: 5, night: false, place: "New York", local: false, zone: "America/New_York" });
    // A station with sky cover but no words still says something; no temperature is a null, never a guess.
    resetWeather();
    resetWeatherProvider();
    service({ [NY]: { temp: null, text: "", layers: ["OVC"] } });
    expect((await weatherFor(null)).weather).toMatchObject({ condition: "cloudy", cloud: 1, tempC: null });
  });
  it("never throws: no reading at all is a null, and the service is left alone for two minutes", async () => {
    fetchMock.mockRejectedValue(new Error("timed out"));
    expect(await weatherFor(null)).toEqual({ weather: null, covered: true });
    expect(await weatherFor(parseCoords(41.9, -87.6))).toEqual({ weather: null, covered: true });
    const before = fetchMock.mock.calls.length;
    await weatherFor(null);
    expect(fetchMock.mock.calls.length).toBe(before);
    service({ [NY]: { text: "Sunny", temp: 20 } });
    vi.setSystemTime(NOW + WEATHER_FAILED_TTL_MS + 1_000);
    expect((await weatherFor(null)).weather?.condition).toBe("clear");
  });
  it("keeps showing a recent reading through a passing failure", async () => {
    expect((await weatherFor(null)).weather?.tempC).toBe(12.2);
    fetchMock.mockResolvedValue(json({}, 503));
    vi.setSystemTime(NOW + WEATHER_TTL_MS + 1_000);
    expect((await weatherFor(null)).weather?.tempC).toBe(12.2);
    // Over an hour old, it is no longer shown as current.
    vi.setSystemTime(NOW + 5 * WEATHER_TTL_MS);
    expect((await weatherFor(null)).weather).toBeNull();
  });
  it("follows only the weather service's own addresses", async () => {
    fetchMock.mockImplementation(async (url: unknown) =>
      String(url).includes("/points/")
        ? json({ properties: { observationStations: "https://evil.example/stations", forecastHourly: "http://169.254.169.254/latest" } })
        : json({}, 500),
    );
    expect((await weatherFor(null)).weather).toBeNull();
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(["https://api.weather.gov/points/40.7,-74.0"]);
  });
});

describe("POST /api/chat/balloons/weather", () => {
  it("refuses someone signed out, a member without Gainers, and another site", async () => {
    auth.mockResolvedValueOnce({ ok: false, status: 401, error: "sign_in_required" });
    expect((await post({})).status).toBe(401);
    auth.mockResolvedValueOnce({ ...member, access: { longboard: false, boardroom: false, shortscout: false, admin: false, botRooms: ["social"] } });
    expect((await post({})).status).toBe(403);
    expect((await post({}, { "content-type": "application/json", origin: "https://elsewhere.example", host: "chat.example.test" })).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("answers New York for an empty body and the viewer's area for a place", async () => {
    service({ [NY]: { text: "Clear", temp: 5 }, "41.9,-87.6": { town: "Chicago", text: "Overcast", temp: 1 } });
    const newYork = await post({});
    expect(newYork.status).toBe(200);
    expect(newYork.headers.get("cache-control")).toBe("private, no-store");
    expect(await newYork.json()).toMatchObject({ covered: true, weather: { place: "New York", local: false, condition: "clear" } });
    expect(await (await post("")).json()).toMatchObject({ weather: { place: "New York" } });
    // Rounded again here, whatever the browser sent.
    expect(await (await post({ lat: 41.8781, lon: -87.6298 })).json()).toMatchObject({ covered: true, weather: { place: "Chicago", local: true, condition: "cloudy" } });
    expect(asked().filter((path) => path.startsWith("/points/"))).toEqual(["/points/40.7,-74.0", "/points/41.9,-87.6"]);
    // Nothing in the answer says where the reading came from.
    expect(JSON.stringify(await (await post({})).json()).toLowerCase()).not.toMatch(/weather\.gov|nws|source|station/);
  });
  it("refuses a bad place instead of guessing", async () => {
    for (const body of [{ lat: 91, lon: 0 }, { lat: "41.9", lon: "-87.6" }, { lat: 41.9 }, { lon: -87.6 }, { lat: null, lon: null }, [41.9, -87.6], "not json", JSON.stringify({ lat: 1, lon: 1, pad: "x".repeat(300) })]) {
      const response = await post(body as never);
      expect(response.status, JSON.stringify(body).slice(0, 40)).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("answers weather: null, not an error, when nothing can be read", async () => {
    fetchMock.mockRejectedValue(new Error("down"));
    const response = await post({ lat: 41.9, lon: -87.6 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ weather: null, covered: true });
  });
  it("limits how often one member can ask", async () => {
    for (let i = 0; i < WEATHER_LIMIT; i++) expect((await post({})).status).toBe(200);
    expect((await post({})).status).toBe(429);
    // Another member is not held up, and the first can ask again after the window.
    auth.mockResolvedValue({ ...member, user: { ...member.user, id: "33333333-3333-4333-8333-333333333333" } });
    expect((await post({})).status).toBe(200);
    auth.mockResolvedValue(member);
    vi.setSystemTime(NOW + WEATHER_LIMIT_WINDOW_MS + 1_000);
    expect((await post({})).status).toBe(200);
    expect(weatherAllowed("x", NOW)).toBe(true);
  });
});
