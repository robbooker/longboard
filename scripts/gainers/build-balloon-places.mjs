#!/usr/bin/env node
// #531 Gainer Balloons: builds the list of U.S. places a member can type to change the weather.
// #532: each place carries its population, so matches list the largest places first.
//
// Sources, all from the U.S. Census Bureau (works of the U.S. government, in the public domain):
//   1. the 2024 Gazetteer "places" file (2024_Gaz_place_national.txt): the places, where they are;
//   2. the 2024 city and town population estimates (sub-est2024.csv): the population of
//      incorporated places (its SUMLEV 162 rows; STATE + PLACE is the gazetteer's GEOID);
//   3. the 2010 Gazetteer "places" file (Gaz_places_national.txt, with a POP10 column): the 2010
//      count, used for places the estimates leave out (unincorporated places, Puerto Rico).
// A place in neither 2 nor 3 counts as 0 people. Download the three files and run:
//
//   node scripts/gainers/build-balloon-places.mjs <2024_Gaz_place_national.txt> <sub-est2024.csv> <Gaz_places_national.txt>
//
// It writes lib/gainerBalloons/placesData.json, which only lib/gainerBalloons/places.server.ts reads
// (server-only: the list never goes to a browser). Per place it keeps the name without its
// "city / town / village / CDP ..." ending, the state, the middle of the place rounded to one
// decimal (about 10 km, the same rounding the weather uses) and the population, rounded. Places
// with the same name in one state are one entry: the most populous (then the largest by land).
//
// The format, kept small: { "TX": "Abbott...|...|Austinxxxfpm|...", ... }. Each place is its name
// followed by seven characters, base-36 numbers:
//   pop   3 characters: round(ln(population + 1) * 2900), so within 0.04% of the count
//   lat   2 characters: round(latitude * 10)
//   lon   2 characters: round(longitude * 10) + 1900 (a place past the date line, in the far Aleutians, counts on west: 173 east is -187)
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [input, estimatesPath, countsPath] = process.argv.slice(2);
if (!input || !estimatesPath || !countsPath) {
  console.error("usage: node scripts/gainers/build-balloon-places.mjs <2024_Gaz_place_national.txt> <sub-est2024.csv> <Gaz_places_national.txt>");
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
const b36 = (value, what, width = 2) => {
  if (!Number.isInteger(value) || value < 0 || value >= 36 ** width) throw new Error(`${what} out of range: ${value}`);
  return value.toString(36).padStart(width, "0");
};

// --- Population by GEOID. The older files are Latin-1; only their digits are read, so that is all that matters.
/** One line of a CSV file as its cells (a quoted cell may hold commas). */
const csvCells = (line) => [...line.matchAll(/("(?:[^"]|"")*"|[^,]*)(?:,|$)/g)].map((m) => m[1].replace(/^"|"$/g, "").replace(/""/g, '"'));
const estimates = new Map();
{
  const rows = readFileSync(estimatesPath, "latin1").split(/\r?\n/).filter((line) => line.trim());
  const head = csvCells(rows.shift());
  const at = Object.fromEntries(["SUMLEV", "STATE", "PLACE", "POPESTIMATE2024"].map((name) => [name, head.indexOf(name)]));
  for (const [name, i] of Object.entries(at)) if (i < 0) throw new Error(`estimates: no ${name} column`);
  for (const row of rows) {
    const cells = csvCells(row);
    if (cells[at.SUMLEV] !== "162") continue;
    const people = Number(cells[at.POPESTIMATE2024]);
    if (Number.isFinite(people) && people >= 0) estimates.set(cells[at.STATE] + cells[at.PLACE], people);
  }
  if (estimates.size < 15_000) throw new Error(`estimates: only ${estimates.size} places read`);
}
const counts = new Map();
{
  const rows = readFileSync(countsPath, "latin1").split(/\r?\n/).filter((line) => line.trim());
  const head = rows.shift().split("\t").map((name) => name.trim());
  const at = { GEOID: head.indexOf("GEOID"), POP10: head.indexOf("POP10") };
  for (const [name, i] of Object.entries(at)) if (i < 0) throw new Error(`2010 counts: no ${name} column`);
  for (const row of rows) {
    const cells = row.split("\t").map((cell) => cell.trim());
    const people = Number(cells[at.POP10]);
    if (Number.isFinite(people) && people >= 0) counts.set(cells[at.GEOID], people);
  }
  if (counts.size < 25_000) throw new Error(`2010 counts: only ${counts.size} places read`);
}

const lines = readFileSync(input, "utf8").split(/\r?\n/).filter((line) => line.trim());
const header = lines.shift().split("\t").map((name) => name.trim());
const col = Object.fromEntries(["USPS", "GEOID", "NAME", "ALAND_SQMI", "INTPTLAT", "INTPTLONG"].map((name) => [name, header.indexOf(name)]));
for (const [name, at] of Object.entries(col)) if (at < 0) throw new Error(`no ${name} column`);

/** state -> folded name -> the most populous place by that name */
const states = new Map();
let read = 0;
const from = { estimates: 0, counts: 0, neither: 0 };
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
  const geoid = cells[col.GEOID];
  const which = estimates.has(geoid) ? "estimates" : counts.has(geoid) ? "counts" : "neither";
  from[which]++;
  const people = which === "estimates" ? estimates.get(geoid) : which === "counts" ? counts.get(geoid) : 0;
  const held = byName.get(key);
  if (!held || people > held.people || (people === held.people && sqmi > held.sqmi)) byName.set(key, { name, people, sqmi, lat, lon });
}

const out = {};
let kept = 0;
for (const state of [...states.keys()].sort()) {
  const places = [...states.get(state).values()].sort((a, b) => a.name.localeCompare(b.name, "en"));
  kept += places.length;
  out[state] = places
    .map((p) => p.name + b36(Math.round(Math.log(p.people + 1) * 2900), "population", 3) + b36(Math.round(p.lat * 10), "lat") + b36(Math.round((p.lon > 0 ? p.lon - 360 : p.lon) * 10) + 1900, "lon"))
    .join("|");
}
const json = JSON.stringify(out) + "\n";
writeFileSync(output, json);
console.log(`population: ${from.estimates} from the 2024 estimates, ${from.counts} from the 2010 count, ${from.neither} in neither`);
console.log(`${read} rows read, ${kept} places kept in ${Object.keys(out).length} states, ${(Buffer.byteLength(json) / 1024).toFixed(0)} KB -> ${path.relative(process.cwd(), output)}`);
