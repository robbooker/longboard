#!/usr/bin/env node
// Longboard — custom-key audio publish script. Phase 3M.
//
// Usage:
//   npm run publish-audio-custom -- --file <path> --key <r2-key> [--dry-run]
//
// Companion to scripts/publish-audio.mjs. The essay script is hardcoded
// to --episode N → NNN.m4a key + frontmatter writes + auto-commits, all
// of which apply only to the numbered essay flow. This script handles
// every other audio drop on R2: business updates, Buddy daily briefings,
// future content types we haven't named yet. It's intentionally small:
// no frontmatter writes, no git commits, no slug detection. Print the
// public URL and exit.
//
// Same re-encode target as the essay script (96 kbps AAC mono 44.1 kHz
// with +faststart) so audio quality is consistent across content types.

import { existsSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { resolve, extname, join, basename, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawn, execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const execFileP = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

const REQUIRED_ENV = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_PUBLIC_URL_BASE",
];
const SUPPORTED_EXTS = new Set([".m4a", ".wav"]);
const TARGET_BITRATE_BPS = 96_000;
const ACCEPTABLE_CODECS = new Set(["aac"]);

function fail(msg) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
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

function validateKey(key) {
  // R2 keys can technically contain almost anything, but for our usage
  // we want lowercase alphanumeric + hyphens + .m4a. Catches common
  // typos like trailing spaces or Windows paths in the key field.
  if (!/^[a-z0-9][a-z0-9-]*\.m4a$/.test(key)) {
    fail(`--key must match ^[a-z0-9][a-z0-9-]*\\.m4a$ — got "${key}"`);
  }
  return key;
}

function requireFfmpeg() {
  try {
    execFileSync("which", ["ffmpeg"], { stdio: "ignore" });
    execFileSync("which", ["ffprobe"], { stdio: "ignore" });
  } catch {
    fail("ffmpeg + ffprobe required on PATH (brew install ffmpeg)");
  }
}

async function probeAudio(filepath) {
  try {
    const { stdout } = await execFileP("ffprobe", [
      "-v", "error",
      "-select_streams", "a:0",
      "-show_entries", "stream=codec_name,bit_rate:format=bit_rate",
      "-of", "json",
      filepath,
    ]);
    const data = JSON.parse(stdout);
    const streamBitrate = parseInt(data.streams?.[0]?.bit_rate, 10);
    const formatBitrate = parseInt(data.format?.bit_rate, 10);
    const bitrate = Number.isFinite(streamBitrate) ? streamBitrate : (Number.isFinite(formatBitrate) ? formatBitrate : null);
    const codec = data.streams?.[0]?.codec_name ?? null;
    return { bitrate, codec };
  } catch {
    return { bitrate: null, codec: null };
  }
}

function reencode(inputPath, outputPath) {
  return new Promise((done, stop) => {
    const args = [
      "-y",
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
  .name("publish-audio-custom")
  .description("Re-encode and upload audio to R2 under an arbitrary key. No frontmatter writes, no git commits.")
  .requiredOption("--file <path>", "input audio path (.m4a or .wav)")
  .requiredOption("--key <key>", "R2 key (e.g. business-update-2026-04-26.m4a)", validateKey)
  .option("--dry-run", "skip ffmpeg, upload — print what would happen", false);

program.parse(process.argv);
const opts = program.opts();

checkRequiredEnv();
requireFfmpeg();

const inputPath = validateInput(opts.file);
const outputKey = opts.key;
const publicUrl = `${process.env.R2_PUBLIC_URL_BASE.replace(/\/$/, "")}/${outputKey}`;

process.stdout.write(
  [
    `Input:       ${inputPath}`,
    `R2 key:      ${outputKey}`,
    `Public URL:  ${publicUrl}`,
    `Input size:  ${mb(statSync(inputPath).size)}MB`,
    "",
  ].join("\n"),
);

if (opts.dryRun) {
  process.stdout.write(
    [
      "[DRY RUN] Would:",
      `  ffmpeg re-encode → 96kbps AAC mono`,
      `  upload to bucket ${process.env.R2_BUCKET_NAME} as ${outputKey}`,
      "",
    ].join("\n"),
  );
  process.exit(0);
}

const { bitrate, codec } = await probeAudio(inputPath);
const shouldReencode = (() => {
  if (!codec || !ACCEPTABLE_CODECS.has(codec)) return true;
  if (!bitrate) return true;
  return bitrate > TARGET_BITRATE_BPS * 1.1;
})();

let uploadPath = inputPath;
let tempPath = null;

if (shouldReencode) {
  tempPath = join(tmpdir(), `longboard-custom-${outputKey}`);
  process.stdout.write(`Re-encoding (${codec ?? "unknown"} @ ${bitrate ?? "?"}bps → aac @ 96kbps mono) ...\n`);
  await reencode(inputPath, tempPath);
  uploadPath = tempPath;
} else {
  process.stdout.write(`Skipping re-encode (already aac @ ${bitrate}bps).\n`);
}

const uploadSize = statSync(uploadPath).size;
process.stdout.write(`Uploading ${mb(uploadSize)}MB to R2 bucket "${process.env.R2_BUCKET_NAME}" as ${outputKey} ...\n`);

const client = r2Client();
const body = readFileSync(uploadPath);
await uploadToR2(client, process.env.R2_BUCKET_NAME, outputKey, body);

if (tempPath && existsSync(tempPath)) {
  try { unlinkSync(tempPath); } catch {}
}

process.stdout.write(
  [
    "",
    "Upload complete.",
    `URL: ${publicUrl}`,
    "",
    "Verify in a browser before wiring into frontmatter / pages. Cloudflare's",
    "custom-domain CDN may take ~60s to propagate a new key.",
    "",
  ].join("\n"),
);
