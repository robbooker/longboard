import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// #531 Gainer Balloons: "Change weather". The place list's matcher (prefix, "city st", state names,
// ranking, no match, length limits), the search route, and the weather route answering a chosen
// place under its own name. The weather service is a stand-in; nothing real is read.
const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: auth }));
vi.mock("server-only", () => ({}));
import { POST as searchRoute } from "@/app/api/chat/balloons/places/route";
import { POST as weatherRoute } from "@/app/api/chat/balloons/weather/route";
import { PLACE_SEARCH_LIMIT, PLACE_SEARCH_WINDOW_MS, foldPlaceText, isDefaultPlace, placeById, placeSearchAllowed, resetPlaceSearch, searchPlaces } from "@/lib/gainerBalloons/places.server";
import { resetWeather } from "@/lib/gainerBalloons/weather.server";
import { resetWeatherProvider } from "@/lib/gainerBalloons/weatherProvider.server";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const member = { ok: true as const, user: { id: "22222222-2222-4222-8222-222222222222", email: "m@example.test", role: "user" as const }, access: { longboard: true, boardroom: true, shortscout: false, admin: false }, serverSession: false };
const labels = (typed: unknown) => searchPlaces(typed).map((place) => place.label);
const post = (route: typeof searchRoute, url: string, body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) =>
  route(new NextRequest(`https://chat.example.test${url}`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }));
const search = (body: unknown, headers?: Record<string, string>) => post(searchRoute, "/api/chat/balloons/places", body, headers);

beforeEach(() => {
  auth.mockReset();
  auth.mockResolvedValue(member);
  resetPlaceSearch();
  resetWeather();
  resetWeatherProvider();
  vi.unstubAllGlobals();
});

describe("searchPlaces", () => {
  it("finds a place by the start of its name, whatever the capitals", () => {
    expect(labels("Austin")[0]).toBe("Austin, TX");
    expect(labels("AUSTIN")).toEqual(labels("austin"));
    expect(labels("aust")[0]).toBe("Austin, TX");
    expect(labels("chica")[0]).toBe("Chicago, IL");
    for (const label of labels("aust")) expect(foldPlaceText(label)).toMatch(/(^| )aust/);
    expect(labels("Austin").length).toBeLessThanOrEqual(6);
  });
  it("puts New York, NY first for \"New York\"", () => {
    const [first] = searchPlaces("New York");
    expect(first).toEqual({ id: "ny:new york", name: "New York", state: "NY", label: "New York, NY", lat: 40.7, lon: -73.9 });
    expect(isDefaultPlace(first)).toBe(true);
    expect(labels("new york")[0]).toBe("New York, NY");
    expect(labels("new yor")[0]).toBe("New York, NY");
    expect(isDefaultPlace(searchPlaces("Austin")[0])).toBe(false);
  });
  it("reads a state after the name: \"austin tx\", \"Austin, TX\", \"Portland, Maine\"", () => {
    expect(labels("austin tx")[0]).toBe("Austin, TX");
    expect(labels("Austin, TX")).toEqual(["Austin, TX"]);
    expect(labels("austin,tx")).toEqual(["Austin, TX"]);
    expect(labels("Austin, Texas")).toEqual(["Austin, TX"]);
    expect(labels("austin mn")[0]).toBe("Austin, MN");
    expect(labels("Portland")[0]).toBe("Portland, OR");
    expect(labels("Portland, Maine")[0]).toBe("Portland, ME");
    expect(labels("portland maine")[0]).toBe("Portland, ME");
    expect(labels("Portland, ME")[0]).toBe("Portland, ME");
    expect(labels("albany new york")[0]).toBe("Albany, NY");
    expect(labels("Washington, DC")[0]).toBe("Washington, DC");
    expect(labels("kansas city mo")[0]).toBe("Kansas City, MO");
    // Still typing the state.
    expect(labels("Portland, M")).toContain("Portland, ME");
    expect(labels("Portland, Ma")[0]).toBe("Portland, ME");
    expect(labels("austin t")[0]).toBe("Austin, TX");
    expect(labels("Austin,")[0]).toBe("Austin, TX");
  });
  it("doesn't mistake the end of a name for a state", () => {
    // "wa" is Washington, but Fort Wayne is what was being typed.
    expect(labels("fort wa")[0]).toBe("Fort Wayne, IN");
    expect(labels("san an")[0]).toBe("San Antonio, TX");
    expect(labels("las vegas")[0]).toBe("Las Vegas, NV");
  });
  it("ranks places by population, largest first, and an exact name ahead of a longer one (#532)", () => {
    const portlands = labels("Portland");
    expect(portlands.indexOf("Portland, OR")).toBeLessThan(portlands.indexOf("Portland, ME"));
    const springfields = searchPlaces("Springfield");
    expect(springfields).toHaveLength(6);
    expect(springfields.every((place) => place.name === "Springfield")).toBe(true);
    expect(springfields.slice(0, 4).map((place) => place.label)).toEqual(["Springfield, MO", "Springfield, MA", "Springfield, IL", "Springfield, OR"]);
    // "port": the big Portland first, and no tiny Alaska place above Portsmouth, VA.
    const ports = labels("port");
    expect(ports[0]).toBe("Portland, OR");
    expect(ports).toContain("Portsmouth, VA");
    expect(ports.slice(0, ports.indexOf("Portsmouth, VA")).filter((label) => label.endsWith(", AK"))).toEqual([]);
    expect(ports).not.toContain("Port Heiden, AK");
    expect(labels("san").slice(0, 3)).toEqual(["San Antonio, TX", "San Diego, CA", "San Jose, CA"]);
    expect(labels("los")[0]).toBe("Los Angeles, CA");
    expect(labels("col")[0]).toBe("Columbus, OH");
    // Miami is far smaller than Miami Gardens' neighbours combined, but it is the name typed.
    expect(labels("Miami")[0]).toBe("Miami, FL");
    // A word inside the name counts, after names that start with the text.
    expect(labels("lauderdale")).toContain("Fort Lauderdale, FL");
  });
  it("knows merged city-counties by the name people type, and ignores accents", () => {
    expect(labels("Nashville")[0]).toBe("Nashville, TN");
    expect(labels("Louisville, KY")[0]).toBe("Louisville, KY");
    expect(labels("Honolulu")[0]).toBe("Honolulu, HI");
    expect(labels("Boise")[0]).toBe("Boise, ID");
    expect(labels("Indianapolis")[0]).toBe("Indianapolis, IN");
    expect(labels("canon city")[0]).toBe("Cañon City, CO");
    expect(labels("San Juan, PR")[0]).toBe("San Juan, PR");
  });
  it("answers nothing for a name that isn't a U.S. place", () => {
    expect(labels("London, England")).toEqual([]);
    expect(labels("Zzyzxq")).toEqual([]);
    expect(labels("Toronto, ON")).toEqual([]);
    expect(labels("Austin, ZZ")).toEqual([]);
  });
  it("answers nothing for under two letters, over 60 characters, or anything that isn't text", () => {
    expect(labels("")).toEqual([]);
    expect(labels("a")).toEqual([]);
    expect(labels(" , ")).toEqual([]);
    expect(labels("!!")).toEqual([]);
    expect(labels("au").length).toBeGreaterThan(0);
    expect(labels(`Austin${" ".repeat(54)}`)).toEqual(["Austin, TX", ...labels("Austin").slice(1)]);
    expect(labels(`Austin${" ".repeat(55)}`)).toEqual([]);
    expect(labels("a".repeat(61))).toEqual([]);
    for (const typed of [null, undefined, 5, {}, ["Austin"]]) expect(labels(typed)).toEqual([]);
  });
  it("gives every place a stable id that finds it again, rounded to one decimal", () => {
    for (const typed of ["Austin", "Portland", "New York", "Cañon City", "Winston-Salem", "St. Louis", "Coeur d'Alene"]) {
      for (const place of searchPlaces(typed)) {
        expect(place.id).toMatch(/^[a-z]{2}:[a-z0-9 ]+$/);
        expect(placeById(place.id)).toEqual(place);
        expect(Math.round(place.lat * 10) / 10).toBe(place.lat);
        expect(Math.round(place.lon * 10) / 10).toBe(place.lon);
      }
    }
    expect(placeById("tx:austin")).toMatchObject({ label: "Austin, TX", lat: 30.3, lon: -97.8 });
    expect(placeById("ak:anchorage")).toMatchObject({ lat: 61.2, lon: -149.3 });
    for (const id of ["tx:nowhere at all", "TX:Austin", "austin", "", "tx:" + "a".repeat(80), null, 7, { id: "tx:austin" }]) expect(placeById(id)).toBeNull();
  });
});

describe("the place list", () => {
  const file = path.resolve(__dirname, "../gainerBalloons/placesData.json");
  it("is small, and every place in it is in or near the United States", () => {
    expect(statSync(file).size).toBeLessThan(700_000);
    const data = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
    expect(Object.keys(data)).toHaveLength(52);
    let count = 0;
    for (const [state, packed] of Object.entries(data)) {
      for (const entry of packed.split("|")) {
        count++;
        const place = placeById(`${state.toLowerCase()}:${foldPlaceText(entry.slice(0, -7))}`);
        if (!place || place.lat < 17 || place.lat > 72 || !(place.lon < -64 || place.lon > 172)) throw new Error(`bad place: ${state} ${entry}`);
      }
    }
    expect(count).toBeGreaterThan(30_000);
  });
  it("is read only by server code: nothing a browser loads imports it", () => {
    const root = path.resolve(__dirname, "../..");
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name.startsWith(".") || name === "__tests__") continue;
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name) && /placesData|places\.server/.test(readFileSync(full, "utf8"))) importers.push(path.relative(root, full));
      }
    };
    for (const dir of ["app", "components", "lib"]) if (existsSync(path.join(root, dir))) walk(path.join(root, dir));
    expect(importers.sort()).toEqual(["app/api/chat/balloons/places/route.ts", "app/api/chat/balloons/weather/route.ts", "lib/gainerBalloons/places.server.ts"]);
    expect(readFileSync(path.join(root, "lib/gainerBalloons/places.server.ts"), "utf8").startsWith('import "server-only";')).toBe(true);
  });
});

describe("POST /api/chat/balloons/places", () => {
  it("refuses someone signed out, a member without Gainers, and another site", async () => {
    auth.mockResolvedValueOnce({ ok: false, status: 401, error: "sign_in_required" });
    expect((await search({ q: "Austin" })).status).toBe(401);
    auth.mockResolvedValueOnce({ ...member, access: { longboard: false, boardroom: false, shortscout: false, admin: false, botRooms: ["social"] } });
    expect((await search({ q: "Austin" })).status).toBe(403);
    expect((await search({ q: "Austin" }, { "content-type": "application/json", origin: "https://elsewhere.example", host: "chat.example.test" })).status).toBe(403);
  });
  it("answers up to six places as an id, a name and \"City, ST\", and nothing else", async () => {
    const response = await search({ q: "austin tx" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const { places } = (await response.json()) as { places: Record<string, unknown>[] };
    expect(places[0]).toEqual({ id: "tx:austin", name: "Austin", label: "Austin, TX" });
    expect(places.length).toBeLessThanOrEqual(6);
    expect(await (await search({ q: "Zzyzxq" })).json()).toEqual({ places: [] });
    expect(await (await search({ q: "a" })).json()).toEqual({ places: [] });
    // Nothing in the answer says where the list came from.
    expect(JSON.stringify(await (await search({ q: "Springfield" })).json()).toLowerCase()).not.toMatch(/census|gazetteer|source|geoid/);
  });
  it("refuses anything that isn't a short piece of text", async () => {
    for (const body of [{}, { q: 5 }, { q: null }, { q: "a".repeat(61) }, ["Austin"], "not json", "", JSON.stringify({ q: "Austin", pad: "x".repeat(400) })]) {
      expect((await search(body as never)).status, JSON.stringify(body).slice(0, 40)).toBe(400);
    }
  });
  it("lets a member search 60 times a minute", async () => {
    for (let i = 0; i < PLACE_SEARCH_LIMIT; i++) expect((await search({ q: "Austin" })).status).toBe(200);
    expect((await search({ q: "Austin" })).status).toBe(429);
    const now = Date.now();
    expect(placeSearchAllowed("someone else", now)).toBe(true);
    expect(placeSearchAllowed(member.user.id, now + PLACE_SEARCH_WINDOW_MS + 1)).toBe(true);
  });
});

describe("POST /api/chat/balloons/weather for a chosen place", () => {
  const points: string[] = [];
  beforeEach(() => {
    points.length = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
      const address = String(url);
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      const point = address.match(/\/points\/(-?\d+\.\d),(-?\d+\.\d)$/);
      if (point) {
        points.push(`${point[1]},${point[2]}`);
        // The nearest town the service names is not always the place that was typed.
        return json({ properties: { relativeLocation: { properties: { city: "Rollingwood", state: "TX" } }, timeZone: point[1] === "40.7" ? "America/New_York" : "America/Chicago", observationStations: `https://api.weather.gov/gridpoints/XXX/1,1/stations?p=${point[1]}`, forecastHourly: null } });
      }
      if (address.includes("/stations?")) return json({ features: [{ properties: { stationIdentifier: address.includes("p=40.7") ? "KNYC" : "KAUS" } }] });
      if (address.endsWith("/stations/KAUS/observations/latest")) return json({ properties: { temperature: { value: 31 }, textDescription: "Sunny" } });
      if (address.endsWith("/stations/KNYC/observations/latest")) return json({ properties: { temperature: { value: 9 }, textDescription: "Overcast" } });
      return json({}, 404);
    }));
  });
  const weather = (body: unknown) => post(weatherRoute, "/api/chat/balloons/weather", body);
  it("answers the place's weather under the name that was chosen", async () => {
    const response = await weather({ place: "tx:austin" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ covered: true, weather: { condition: "clear", cloud: 0.05, tempC: 31, night: false, place: "Austin", local: true, zone: "America/Chicago" } });
    expect(points).toEqual(["30.3,-97.8"]);
    // The browser's own position still reads the nearest town's name.
    expect(await (await weather({ lat: 30.3, lon: -97.8 })).json()).toMatchObject({ weather: { place: "Rollingwood", local: true } });
  });
  it("treats New York, NY as the default again", async () => {
    expect(await (await weather({ place: "ny:new york" })).json()).toMatchObject({ covered: true, weather: { place: "New York", local: false, condition: "cloudy", zone: "America/New_York" } });
    expect(points).toEqual(["40.7,-74.0"]);
  });
  it("refuses a place it doesn't know, and a place together with a position", async () => {
    for (const body of [{ place: "tx:nowhere at all" }, { place: "Austin, TX" }, { place: 5 }, { place: null }, { place: "tx:austin", lat: 30.3, lon: -97.8 }]) {
      expect((await weather(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(points).toEqual([]);
  });
});
