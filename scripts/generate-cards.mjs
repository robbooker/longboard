#!/usr/bin/env node
// Longboard — share card generator. Phase 3M.
//
// Usage:
//   npm run generate-cards -- --all
//   npm run generate-cards -- --slug confidence-is-built-not-declared
//   npm run generate-cards -- --help
//
// Reads essay frontmatter, renders each card variant (2 treatments ×
// 3 sizes) via Puppeteer screenshotting scripts/card-template.html,
// writes PNGs to public/og/.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import matter from "gray-matter";
import puppeteer from "puppeteer";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const ESSAYS_DIR = join(PROJECT_ROOT, "content", "essays");
const OUT_DIR = join(PROJECT_ROOT, "public", "og");
const TEMPLATE_PATH = join(__dirname, "card-template.html");

const TREATMENTS = ["a", "b"];
const SIZES = [
  { label: "og", w: 1200, h: 630 },
  { label: "square", w: 1080, h: 1080 },
  { label: "story", w: 1080, h: 1920 },
];

function fail(msg) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

function pad3(n) {
  return String(n).padStart(3, "0");
}

function loadEssays() {
  const files = readdirSync(ESSAYS_DIR).filter((f) => f.endsWith(".mdx"));
  return files.map((f) => {
    const raw = readFileSync(join(ESSAYS_DIR, f), "utf8");
    const { data } = matter(raw);
    const slug = f.replace(/\.mdx$/, "").replace(/^\d+-/, "");
    return {
      slug,
      issue: Number(data.issue) || 0,
      kicker: data.share_kicker || (data.issue_label ? `On ${String(data.issue_label).toLowerCase()}` : "On process"),
      quoteA: data.share_quote_a || null,
      quoteB: data.share_quote_b || null,
    };
  });
}

const program = new Command();
program
  .name("generate-cards")
  .description("Generate share-card PNGs for Longboard essays via Puppeteer.")
  .option("--all", "generate cards for all essays")
  .option("--slug <slug>", "generate cards for one essay by slug")
  .helpOption("-h, --help", "show this help");

program.parse(process.argv);
const opts = program.opts();

if (!opts.all && !opts.slug) {
  fail("Pass --all or --slug <slug>. Run --help for usage.");
}

if (!existsSync(TEMPLATE_PATH)) {
  fail(`Card template not found at ${TEMPLATE_PATH}`);
}

const allEssays = loadEssays();
const essays = opts.slug
  ? allEssays.filter((e) => e.slug === opts.slug)
  : allEssays;

if (essays.length === 0) {
  fail(opts.slug ? `No essay matches slug "${opts.slug}"` : "No essays found in content/essays/");
}

const totalCards = essays.length * TREATMENTS.length * SIZES.length;
process.stdout.write(`Generating ${totalCards} cards for ${essays.length} essay${essays.length > 1 ? "s" : ""}...\n`);

mkdirSync(OUT_DIR, { recursive: true });

const templateUrl = `file://${TEMPLATE_PATH}`;
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });

let count = 0;
let skipped = 0;

for (const essay of essays) {
  for (const treatment of TREATMENTS) {
    const quote = treatment === "a" ? essay.quoteA : essay.quoteB;
    if (!quote) {
      process.stderr.write(`  warn: ${essay.slug} missing share_quote_${treatment}, skipping treatment ${treatment.toUpperCase()}\n`);
      skipped += SIZES.length;
      continue;
    }

    for (const size of SIZES) {
      count++;
      const filename = `${essay.slug}-${treatment}-${size.label}.png`;
      const outPath = join(OUT_DIR, filename);

      const params = new URLSearchParams({
        treatment,
        w: String(size.w),
        h: String(size.h),
        kicker: essay.kicker,
        quote,
        issue: pad3(essay.issue),
      });

      const page = await browser.newPage();
      await page.setViewport({ width: size.w, height: size.h, deviceScaleFactor: 1 });
      await page.goto(`${templateUrl}?${params.toString()}`, { waitUntil: "networkidle0" });

      // Screenshot the .card element at exact dimensions.
      const card = await page.$(".card");
      if (!card) {
        process.stderr.write(`  warn: .card not found for ${filename}, skipping\n`);
        await page.close();
        skipped++;
        continue;
      }

      await card.screenshot({ path: outPath, type: "png" });
      await page.close();

      const kb = Math.round(statSync(outPath).size / 1024);
      process.stdout.write(`  [${count}/${totalCards}] ✓ ${filename} (${size.w}×${size.h}, ${kb}KB)\n`);
    }
  }
}

await browser.close();

process.stdout.write(`\nDone. ${count - skipped} cards written to public/og/`);
if (skipped > 0) process.stdout.write(` (${skipped} skipped)`);
process.stdout.write(".\n");
