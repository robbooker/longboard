#!/usr/bin/env node
// #531 Gainer Balloons: builds the list of U.S. places a member can type to change the weather.
//
// Source: the U.S. Census Bureau's 2024 Gazetteer "places" file (2024_Gaz_place_national.txt, a
// work of the U.S. government, in the public domain). Download it from the Census Gazetteer Files
// page and run:
//
//   node scripts/gainers/build-balloon-places.mjs <path to 2024_Gaz_place_national.txt>
//
// It writes lib/gainerBalloons/placesData.json, which only lib/gainerBalloons/places.server.ts reads
// (server-only: the list never goes to a browser). Per place it keeps the name without its
// "city / town / village / CDP ..." ending, the state, the middle of the place rounded to one
// decimal (about 10 km, the same rounding the weather uses) and the land area. The file has no
// population, so places with the same name are ranked by land area.
//
// The format, kept small: { "TX": "Abbott...|...|Austinc28fpm|...", ... }. Each place is its name followed
// by six characters, three two-character base-36 numbers:
//   area  round(sqrt(land square miles) * 24)
//   lat   round(latitude * 10)
//   lon   round(longitude * 10) + 1900 (a place past the date line, in the far Aleutians, counts on west: 173 east is -187)
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const input = process.argv[2];
if (!input) {
  console.error("usage: node scripts/gainers/build-balloon-places.mjs <2024_Gaz_place_national.txt>");
  process.exit(1);
}
const output = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../lib/gainerBalloons/placesData.json");

// The kind of place, as the file writes it after the name. Longest first.
const ENDINGS = [
  "metropolitan government",
  "consolidated government",
  "unified government",
  "metro government",
  "city and borough",
  "urban county",
  "zona urbana",
  "municipality",
  "corporation",
  "comunidad",
  "township",
  "borough",
  "village",
  "city",
  "town",
  "CDP",
];
// Merged city-county governments and a few others, by the name people type.
const KNOWN_AS = {
  "TN|Nashville-Davidson": "Nashville",
  "KY|Louisville/Jefferson County": "Louisville",
  "KY|Lexington-Fayette": "Lexington",
  "GA|Athens-Clarke County": "Athens",
  "GA|Augusta-Richmond County": "Augusta",
  "GA|Macon-Bibb County": "Macon",
  "HI|Urban Honolulu": "Honolulu",
  "ID|Boise City": "Boise",
  "MT|Butte-Silver Bow": "Butte",
  "MT|Anaconda-Deer Lodge County": "Anaconda",
  "CA|San Buenaventura (Ventura)": "Ventura",
  "CA|El Paso de Robles (Paso Robles)": "Paso Robles",
};

/** The same folding places.server.ts uses to compare names: lower case, no accents, letters and digits only. */
const fold = (text) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const b36 = (value, what) => {
  if (!Number.isInteger(value) || value < 0 || value > 1295) throw new Error(`${what} out of range: ${value}`);
  return value.toString(36).padStart(2, "0");
};

const lines = readFileSync(input, "utf8").split(/\r?\n/).filter((line) => line.trim());
const header = lines.shift().split("\t").map((name) => name.trim());
const col = Object.fromEntries(["USPS", "NAME", "ALAND_SQMI", "INTPTLAT", "INTPTLONG"].map((name) => [name, header.indexOf(name)]));
for (const [name, at] of Object.entries(col)) if (at < 0) throw new Error(`no ${name} column`);

/** state -> folded name -> the largest place by that name */
const states = new Map();
let read = 0;
for (const line of lines) {
  const cells = line.split("\t").map((cell) => cell.trim());
  const state = cells[col.USPS];
  let name = cells[col.NAME].replace(/ \(balance\)$/, "");
  const ending = ENDINGS.find((e) => name.endsWith(` ${e}`));
  if (ending) name = name.slice(0, -ending.length - 1);
  name = (KNOWN_AS[`${state}|${name}`] ?? name).trim();
  const sqmi = Number(cells[col.ALAND_SQMI]);
  const lat = Number(cells[col.INTPTLAT]);
  const lon = Number(cells[col.INTPTLONG]);
  if (!/^[A-Z]{2}$/.test(state) || !name || name.includes("|") || ![sqmi, lat, lon].every(Number.isFinite)) throw new Error(`bad row: ${line}`);
  read++;
  const key = fold(name);
  if (!key) throw new Error(`a name with no letters: ${name}`);
  const byName = states.get(state) ?? new Map();
  states.set(state, byName);
  const held = byName.get(key);
  if (!held || sqmi > held.sqmi) byName.set(key, { name, sqmi, lat, lon });
}

const out = {};
let kept = 0;
for (const state of [...states.keys()].sort()) {
  const places = [...states.get(state).values()].sort((a, b) => a.name.localeCompare(b.name, "en"));
  kept += places.length;
  out[state] = places
    .map((p) => p.name + b36(Math.min(1295, Math.round(Math.sqrt(p.sqmi) * 24)), "area") + b36(Math.round(p.lat * 10), "lat") + b36(Math.round((p.lon > 0 ? p.lon - 360 : p.lon) * 10) + 1900, "lon"))
    .join("|");
}
const json = JSON.stringify(out) + "\n";
writeFileSync(output, json);
console.log(`${read} rows read, ${kept} places kept in ${Object.keys(out).length} states, ${(Buffer.byteLength(json) / 1024).toFixed(0)} KB -> ${path.relative(process.cwd(), output)}`);
