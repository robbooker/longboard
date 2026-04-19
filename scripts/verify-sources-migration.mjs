#!/usr/bin/env node
// Verifies every essay's sources are structured objects with
// author/title/year/gloss. Reports any that are still strings
// or missing required fields. Exits 0 if clean, 1 if not.

import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ESSAYS_DIR = join(__dirname, "..", "content", "essays");
const REQUIRED_FIELDS = ["author", "title", "year", "gloss"];

const files = readdirSync(ESSAYS_DIR).filter((f) => f.endsWith(".mdx")).sort();
let totalFiles = 0;
let totalSources = 0;
let errors = 0;

for (const file of files) {
  const raw = readFileSync(join(ESSAYS_DIR, file), "utf8");
  const { data } = matter(raw);
  totalFiles++;

  if (!data.sources || !Array.isArray(data.sources)) {
    console.log(`  WARN: ${file} — no sources array`);
    continue;
  }

  for (let i = 0; i < data.sources.length; i++) {
    totalSources++;
    const src = data.sources[i];

    if (typeof src === "string") {
      console.log(`  FAIL: ${file} source ${i + 1} — still a string: "${src.slice(0, 60)}..."`);
      errors++;
      continue;
    }

    if (typeof src !== "object" || src === null) {
      console.log(`  FAIL: ${file} source ${i + 1} — unexpected type: ${typeof src}`);
      errors++;
      continue;
    }

    for (const field of REQUIRED_FIELDS) {
      if (src[field] === undefined || src[field] === null || src[field] === "") {
        console.log(`  FAIL: ${file} source ${i + 1} — missing field: ${field}`);
        errors++;
      }
    }

    if (typeof src.year !== "number") {
      console.log(`  FAIL: ${file} source ${i + 1} — year is not a number: ${JSON.stringify(src.year)}`);
      errors++;
    }
  }
}

console.log(`\n${totalFiles} files, ${totalSources} sources, ${errors} errors`);
process.exit(errors > 0 ? 1 : 0);
