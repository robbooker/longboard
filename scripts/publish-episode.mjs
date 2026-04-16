#!/usr/bin/env node
// Longboard — episode publish pipeline. Phase 3N.
//
// Usage:
//   npm run publish-episode -- --episode <N>
//   npm run publish-episode -- --help
//
// Reads the draft from content/drafts/{NNN}-draft.md, moves it to
// content/essays/{NNN}-{slug}.mdx, runs Phase 3K audio publish +
// Phase 3M card generation, and commits locally (no push).

import { existsSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from "node:fs";
import { resolve, join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import matter from "gray-matter";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const DRAFTS_DIR = join(PROJECT_ROOT, "content", "drafts");
const ESSAYS_DIR = join(PROJECT_ROOT, "content", "essays");

function fail(msg) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

function pad3(n) {
  return String(n).padStart(3, "0");
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} [Y/n] `)).trim().toLowerCase();
    return answer === "" || answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

function runScript(scriptName, args) {
  process.stdout.write(`\nRunning ${scriptName}...\n`);
  const result = spawnSync("node", [
    "--env-file=.env.local",
    join(__dirname, scriptName),
    ...args,
  ], { cwd: PROJECT_ROOT, stdio: "inherit" });
  if (result.status !== 0) {
    fail(`${scriptName} failed (exit ${result.status})`);
  }
}

const program = new Command();
program
  .name("publish-episode")
  .description("Publish a reviewed draft: move to essays, upload audio, generate cards, commit locally.")
  .requiredOption("--episode <N>", "episode number (1-999)", (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 999) fail(`--episode must be 1..999, got ${v}`);
    return n;
  })
  .helpOption("-h, --help", "show this help");

program.parse(process.argv);
const opts = program.opts();

const episodeNo = opts.episode;
const padded = pad3(episodeNo);

// ── Validate draft exists ─────────────────────────────────
const draftPath = join(DRAFTS_DIR, `${padded}-draft.md`);
if (!existsSync(draftPath)) {
  fail(`No draft found at ${draftPath}. Run ingest-episode first.`);
}

const raw = readFileSync(draftPath, "utf8");
const { data: fm, content: body } = matter(raw);

const slug = fm.slug ? String(fm.slug).replace(/^"|"$/g, "") : "";
if (!slug) fail("Draft frontmatter missing 'slug' field");

const title = fm.title ? String(fm.title).replace(/^"|"$/g, "") : "(untitled)";
const essayFilename = `${padded}-${slug}.mdx`;
const essayPath = join(ESSAYS_DIR, essayFilename);

// Check for collision with existing essay.
if (existsSync(essayPath)) {
  process.stdout.write(`Essay already exists at ${relative(PROJECT_ROOT, essayPath)}.\n`);
  process.stdout.write("Re-running will overwrite it.\n");
}

process.stdout.write(
  [
    `Draft:    ${relative(PROJECT_ROOT, draftPath)}`,
    `Title:    ${title}`,
    `Slug:     ${slug}`,
    `Target:   ${relative(PROJECT_ROOT, essayPath)}`,
    "",
  ].join("\n"),
);

const ok = await confirm(`Publish issue ${padded}: "${title}"?`);
if (!ok) {
  process.stdout.write("Aborted.\n");
  process.exit(0);
}

// ── Step 1: Copy draft to essays as .mdx ──────────────────
writeFileSync(essayPath, raw);
process.stdout.write(`Copied draft → ${relative(PROJECT_ROOT, essayPath)}\n`);

// ── Step 2: Audio publish (Phase 3K) ──────────────────────
// Look for a source audio file. Convention: the original audio that
// was ingested should still be available. If the user used
// ingest-episode, the source file was passed via --file. We check
// if audio_url is already set in frontmatter (maybe from a prior
// run) and skip if so.
const audioUrl = fm.audio_url ? String(fm.audio_url) : "";
if (audioUrl) {
  process.stdout.write(`audio_url already set: ${audioUrl} — skipping audio publish.\n`);
} else {
  // Look for the original audio in common locations.
  const audioCandidates = [
    join("/Users/Shared", `${padded}.m4a`),
    join(process.env.HOME || "~", `${padded}.m4a`),
    join(process.env.HOME || "~", "Downloads", `${padded}.m4a`),
  ];
  const audioFile = audioCandidates.find((f) => existsSync(f));
  if (audioFile) {
    process.stdout.write(`Found audio at ${audioFile}\n`);
    // Shell out to publish-audio with "y" piped for the confirmation.
    const paResult = spawnSync("node", [
      "--env-file=.env.local",
      join(__dirname, "publish-audio.mjs"),
      "--file", audioFile,
      "--episode", String(episodeNo),
    ], {
      cwd: PROJECT_ROOT,
      stdio: ["pipe", "inherit", "inherit"],
      input: "y\n",
    });
    if (paResult.status !== 0) {
      process.stderr.write("warn: audio publish failed. Continue without audio.\n");
    }
    // Re-read the essay in case publish-audio updated audio_url.
  } else {
    process.stdout.write(`No audio file found for episode ${padded} — skipping audio publish.\n`);
    process.stdout.write("  (Run publish-audio manually later if needed.)\n");
  }
}

// ── Step 3: Generate share cards (Phase 3M) ───────────────
runScript("generate-cards.mjs", ["--slug", slug]);

// ── Step 4: Git stage + commit ────────────────────────────
process.stdout.write("\nStaging changes...\n");
const filesToAdd = [
  relative(PROJECT_ROOT, essayPath),
  `public/og/${slug}-*.png`,
];

// Also add audio-updated essay if publish-audio modified it.
for (const f of filesToAdd) {
  try {
    execFileSync("git", ["add", f], { cwd: PROJECT_ROOT, stdio: "ignore" });
  } catch {}
}

// Stage any card PNGs via glob.
try {
  const ogDir = join(PROJECT_ROOT, "public", "og");
  const cards = readdirSync(ogDir).filter((f) => f.startsWith(slug) && f.endsWith(".png"));
  for (const c of cards) {
    execFileSync("git", ["add", join("public", "og", c)], { cwd: PROJECT_ROOT, stdio: "ignore" });
  }
} catch {}

const commitMsg = `publish: issue ${padded} — ${title}`;
try {
  execFileSync("git", ["commit", "-m", commitMsg], { cwd: PROJECT_ROOT, stdio: "inherit" });
  process.stdout.write(`\nCommitted locally. Run \`git push origin main\` to deploy.\n`);
} catch {
  process.stdout.write(`\nNo changes to commit (essay may already be published).\n`);
}
