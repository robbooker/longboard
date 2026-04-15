#!/usr/bin/env node
// Longboard — audio publish script. Phase 3K.
//
// Usage:
//   npm run publish-audio -- --file <path> --episode <N> [--dry-run]
//   npm run publish-audio -- --help
//
// Loads .env.local via Node's native --env-file flag (wired in the
// npm script). Commit 1 wires the CLI surface + input validation
// only — ffmpeg + R2 + frontmatter land in C2 and C3.

import { existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { Command } from "commander";

const REQUIRED_ENV = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_PUBLIC_URL_BASE",
];
const SUPPORTED_EXTS = new Set([".m4a", ".wav"]);

/** One-line red-ish error on stderr + exit 1. No stack traces — the
 *  audit doc calls for descriptive single-line errors so scrolled
 *  terminals still show the actionable message. */
function fail(msg) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

function parseEpisode(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 999) {
    fail(`--episode must be 1..999, got ${value}`);
  }
  return n;
}

function pad3(n) {
  return String(n).padStart(3, "0");
}

function checkRequiredEnv() {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k] || process.env[k].trim() === "");
  if (missing.length > 0) {
    fail(`Missing env: ${missing.join(", ")} (expected in .env.local)`);
  }
}

function validateInput(filePath) {
  const abs = resolve(filePath);
  if (!existsSync(abs)) fail(`File not found: ${filePath}`);
  const ext = extname(abs).toLowerCase();
  if (!SUPPORTED_EXTS.has(ext)) {
    fail(`Unsupported input: expected .m4a or .wav, got ${ext || "(no extension)"}`);
  }
  return abs;
}

const program = new Command();
program
  .name("publish-audio")
  .description("Re-encode, upload to R2, and wire a new episode's audio into its essay frontmatter.")
  .requiredOption("--file <path>", "input audio file (.m4a or .wav)")
  .requiredOption("--episode <N>", "episode number (1-999)", parseEpisode)
  .option("--dry-run", "skip ffmpeg, upload, frontmatter write, commit — print what would happen", false)
  .helpOption("-h, --help", "show this help");

program.parse(process.argv);
const opts = program.opts();

// ── Validation phase ──────────────────────────────────────
// Env first so the user sees missing creds before the file check
// complains about a Voice Memo they then fix — one issue at a time.
checkRequiredEnv();
const inputPath = validateInput(opts.file);
const episodeNo = opts.episode;
const outputKey = `${pad3(episodeNo)}.m4a`;
const publicUrl = `${process.env.R2_PUBLIC_URL_BASE.replace(/\/$/, "")}/${outputKey}`;

// ── Summary ───────────────────────────────────────────────
process.stdout.write(
  [
    `Input:       ${inputPath}`,
    `Episode:     ${episodeNo} (key: ${outputKey})`,
    `Bucket:      ${process.env.R2_BUCKET_NAME}`,
    `Public URL:  ${publicUrl}`,
    `Dry run:     ${opts.dryRun ? "yes" : "no"}`,
    "",
  ].join("\n"),
);

// Subsequent commits (C2–C3) will append:
//   1. ffmpeg re-encode to a temp path
//   2. R2 PutObjectCommand upload
//   3. frontmatter update on content/essays/{NNN}-*.mdx
//   4. git add + git commit -m "chore: add audio for issue {NNN}"
// For now, C1 stops after validation so Rob can exercise the
// surface without any side effects.
process.stdout.write("validation-only scaffold — C2/C3 will add encode, upload, and frontmatter steps.\n");
