#!/usr/bin/env node
// Longboard — audio publish script. Phase 3K.
//
// Usage:
//   npm run publish-audio -- --file <path> --episode <N> [--dry-run]
//   npm run publish-audio -- --help
//
// Loads .env.local via Node's native --env-file flag (wired in the
// npm script). Commits 1–2 cover env/arg validation → ffmpeg
// re-encode → R2 upload. C3 will add the frontmatter + commit steps.

import { existsSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { resolve, extname, join, basename } from "node:path";
import { tmpdir } from "node:os";
import { spawn, execFileSync } from "node:child_process";
import { Command } from "commander";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

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

/** Verifies ffmpeg is on PATH. Per the audit doc, ffmpeg is a hard
 *  dependency — we prefer failing before any other work with a clean
 *  "brew install" suggestion over crashing mid-encode. Runs even
 *  under --dry-run so the dry-run doubles as an env readiness check. */
function requireFfmpeg() {
  try {
    execFileSync("which", ["ffmpeg"], { stdio: "ignore" });
  } catch {
    fail("ffmpeg not installed. Run: brew install ffmpeg");
  }
}

/** Spawns ffmpeg to re-encode to 96 kbps AAC mono 44.1 kHz with
 *  `+faststart` so the moov atom lives at the head of the file —
 *  browsers and podcast apps can start playback without downloading
 *  the whole thing. Streams stderr verbatim so ffmpeg's periodic
 *  stats line is visible during long encodes, and we retain the
 *  last non-empty stderr line to surface as the failure message if
 *  ffmpeg exits non-zero. */
function reencode(inputPath, outputPath) {
  return new Promise((done, stop) => {
    const args = [
      "-y", // overwrite temp output silently
      "-i", inputPath,
      "-c:a", "aac",
      "-b:a", "96k",
      "-ac", "1",
      "-ar", "44100",
      "-movflags", "+faststart",
      "-loglevel", "error",
      "-stats",
      outputPath,
    ];
    const proc = spawn("ffmpeg", args);
    let lastErr = "";
    proc.stderr.on("data", (chunk) => {
      const s = chunk.toString();
      process.stderr.write(s);
      const line = s.split("\n").filter(Boolean).pop();
      if (line) lastErr = line;
    });
    proc.on("error", (e) => stop(e));
    proc.on("close", (code) => {
      if (code === 0) done();
      else stop(new Error(lastErr.trim() || `ffmpeg exit ${code}`));
    });
  });
}

function r2Client() {
  return new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

/** Upload to R2 via the S3-compatible API. No ACL — Cloudflare rejects
 *  it on R2, the bucket's custom-domain config handles public access.
 *  Classifies common AWS SDK errors into actionable one-liners before
 *  falling through to a generic "R2 upload failed: …" catch-all. */
async function uploadToR2(client, bucket, key, body) {
  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "audio/mp4",
    }));
  } catch (e) {
    const name = e && e.name;
    const msg = (e && e.message) || String(e);
    if (name === "InvalidAccessKeyId" || name === "SignatureDoesNotMatch") {
      fail(`R2 auth failed: check R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY\n${msg}`);
    }
    if (name === "NoSuchBucket") {
      fail(`R2 bucket not found: ${bucket}\n${msg}`);
    }
    fail(`R2 upload failed: ${msg}`);
  }
}

function mb(bytes) {
  return (bytes / 1024 / 1024).toFixed(1);
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

// ── Readiness ─────────────────────────────────────────────
// ffmpeg check runs even in --dry-run so the dry-run catches a
// broken install before Rob reaches for the tape.
requireFfmpeg();

if (opts.dryRun) {
  process.stdout.write(
    [
      "dry-run: would ...",
      `  encode ${basename(inputPath)} → 96k AAC mono 44.1kHz`,
      `  upload to bucket ${process.env.R2_BUCKET_NAME} as ${outputKey}`,
      `  print public URL ${publicUrl}`,
      "(C3 will add: frontmatter update + git commit)",
      "",
    ].join("\n"),
  );
  process.exit(0);
}

// ── Encode ────────────────────────────────────────────────
const tempPath = join(tmpdir(), `longboard-${outputKey}`);
process.stdout.write(`Encoding → ${tempPath}\n`);
try {
  await reencode(inputPath, tempPath);
} catch (e) {
  fail(`ffmpeg failed: ${e.message || e}`);
}
if (!existsSync(tempPath)) fail("ffmpeg produced no output file");

const inSize = statSync(inputPath).size;
const outSize = statSync(tempPath).size;
process.stdout.write(`Encoded ${mb(inSize)}MB → ${mb(outSize)}MB\n`);
if (outSize >= inSize) {
  process.stderr.write(`warning: re-encoded file is not smaller (${mb(outSize)}MB vs ${mb(inSize)}MB)\n`);
}

// ── Upload ────────────────────────────────────────────────
process.stdout.write(`Uploading to R2 bucket "${process.env.R2_BUCKET_NAME}" as ${outputKey} ...\n`);
const client = r2Client();
const body = readFileSync(tempPath);
await uploadToR2(client, process.env.R2_BUCKET_NAME, outputKey, body);
process.stdout.write(`Uploaded: ${publicUrl}\n`);

// Best-effort cleanup. If it fails (permissions, race), the OS
// tmpdir gets cleaned eventually — not worth failing the run over.
try { unlinkSync(tempPath); } catch {}

process.stdout.write("upload complete — C3 will add frontmatter + commit steps.\n");
