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

import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve, extname, join, basename, dirname, relative } from "node:path";
import { tmpdir } from "node:os";
import { execFile, spawn, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const ESSAYS_DIR = join(PROJECT_ROOT, "content", "essays");

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

const TARGET_BITRATE_BPS = 96_000;
const ACCEPTABLE_CODECS = new Set(["aac"]);

/** Probes audio bitrate + codec via ffprobe. Falls back to
 *  format-level bitrate when stream-level is absent (common for VBR).
 *  Returns nulls on any failure so the caller defaults to re-encoding. */
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

/** Finds the essay .mdx file matching a zero-padded episode prefix.
 *  Returns `{ found: null }` on no match (non-fatal — the caller
 *  prints the URL and exits 0 so Rob can paste manually). Multi-match
 *  is always a hard fail; the NNN- prefix should be unique. */
function findEssayFile(paddedEpisode) {
  const prefix = `${paddedEpisode}-`;
  const matches = readdirSync(ESSAYS_DIR).filter(
    (f) => f.startsWith(prefix) && f.endsWith(".mdx"),
  );
  if (matches.length === 0) return { found: null, matches };
  if (matches.length > 1) {
    fail(`Multiple essays match ${prefix}*.mdx — refusing to guess: ${matches.join(", ")}`);
  }
  return { found: join(ESSAYS_DIR, matches[0]), matches };
}

/** Surgical frontmatter update. Deliberately does not round-trip
 *  through a YAML parser — gray-matter.stringify re-serializes the
 *  whole block and drifts heavily (double-quoted strings un-quote,
 *  long strings fold with `>-`, YAML-parsed dates emit ISO), which
 *  would produce enormous noise diffs on every run. Instead we find
 *  the frontmatter block by its `---\n...\n---\n` markers and either
 *  replace the existing audio_url line or insert a new one right
 *  after `published:`. Everything else stays byte-identical.
 *
 *  Returns "unchanged" when the URL already matches (idempotent
 *  re-runs), "updated" when overwriting a different value,
 *  "inserted" when adding the field for the first time. */
function updateFrontmatter(filePath, newUrl) {
  const raw = readFileSync(filePath, "utf8");
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) fail(`No YAML frontmatter found in ${filePath}`);

  const fm = fmMatch[1];
  const afterFm = raw.slice(fmMatch[0].length);

  const existing = fm.match(/^audio_url:\s*(.+?)\s*$/m);
  let newFm;
  let status;

  if (existing) {
    // Strip optional surrounding quotes before comparing, so a quoted
    // value in the file still compares equal to the bare URL we pass.
    const currentValue = existing[1].trim().replace(/^['"]|['"]$/g, "");
    if (currentValue === newUrl) return "unchanged";
    newFm = fm.replace(/^audio_url:\s*.+$/m, `audio_url: "${newUrl}"`);
    status = "updated";
  } else {
    const publishedMatch = fm.match(/^published:\s*.+$/m);
    if (publishedMatch && publishedMatch.index !== undefined) {
      const insertAt = publishedMatch.index + publishedMatch[0].length;
      newFm = fm.slice(0, insertAt) + `\naudio_url: "${newUrl}"` + fm.slice(insertAt);
    } else {
      // No `published:` anchor — append to the bottom. Unusual but
      // not worth failing over.
      newFm = `${fm}\naudio_url: "${newUrl}"`;
    }
    status = "inserted";
  }

  writeFileSync(filePath, `---\n${newFm}\n---\n${afterFm}`);
  return status;
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

/** Runs `git add` + `git commit` for the updated essay file. Catches
 *  the "nothing to commit" non-zero exit so a re-run with no
 *  frontmatter change still prints a useful message. Never pushes —
 *  the audit doc is explicit: commit is local, push is Rob's call. */
function gitStageAndCommit(filePath, paddedEpisode) {
  const rel = relative(PROJECT_ROOT, filePath);
  execFileSync("git", ["add", rel], { cwd: PROJECT_ROOT, stdio: "inherit" });
  try {
    execFileSync(
      "git",
      ["commit", "-m", `chore: add audio for issue ${paddedEpisode}`],
      { cwd: PROJECT_ROOT, stdio: "inherit" },
    );
    return "committed";
  } catch {
    // `git commit` exits non-zero when there's nothing staged / no
    // changes vs HEAD. Idempotent re-runs land here.
    return "no-changes";
  }
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
  const { found } = findEssayFile(pad3(episodeNo));
  const lines = [
    "dry-run: would ...",
    `  encode ${basename(inputPath)} → 96k AAC mono 44.1kHz`,
    `  upload to bucket ${process.env.R2_BUCKET_NAME} as ${outputKey}`,
  ];
  if (found) {
    lines.push(`  update ${relative(PROJECT_ROOT, found)} audio_url → ${publicUrl}`);
    lines.push(`  git add + git commit -m "chore: add audio for issue ${pad3(episodeNo)}"`);
    lines.push(`  print "Committed locally. Run \`git push origin main\` to deploy."`);
  } else {
    lines.push(`  (no essay matches ${pad3(episodeNo)}-*.mdx — would print URL only, skip commit)`);
  }
  lines.push("");
  process.stdout.write(lines.join("\n"));
  process.exit(0);
}

// ── Probe + encode ────────────────────────────────────────
const { bitrate, codec } = await probeAudio(inputPath);

const shouldReencode = (() => {
  if (!codec || !ACCEPTABLE_CODECS.has(codec)) return true;
  if (bitrate == null) return true;
  if (bitrate > TARGET_BITRATE_BPS) return true;
  return false;
})();

let uploadPath;
let tempPath = null;

if (shouldReencode) {
  const bitrateLabel = bitrate ? `${Math.round(bitrate / 1000)}kbps` : "unknown bitrate";
  process.stdout.write(`Re-encoding (source ${codec ?? "unknown"} at ${bitrateLabel} → 96kbps mono)\n`);
  tempPath = join(tmpdir(), `longboard-${outputKey}`);
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
  uploadPath = tempPath;
} else {
  process.stdout.write(`Skipping re-encode (source ${codec} at ${Math.round(bitrate / 1000)}kbps is already at or below target)\n`);
  uploadPath = inputPath;
}

// ── Upload ────────────────────────────────────────────────
const uploadSize = statSync(uploadPath).size;
process.stdout.write(`Uploading ${mb(uploadSize)}MB to R2 bucket "${process.env.R2_BUCKET_NAME}" as ${outputKey} ...\n`);
const client = r2Client();
const body = readFileSync(uploadPath);
await uploadToR2(client, process.env.R2_BUCKET_NAME, outputKey, body);
process.stdout.write(`Uploaded: ${publicUrl}\n`);

// Best-effort cleanup of temp file (only exists if we re-encoded).
if (tempPath) { try { unlinkSync(tempPath); } catch {} }

// ── Frontmatter + commit ──────────────────────────────────
const { found: essayPath } = findEssayFile(pad3(episodeNo));
if (!essayPath) {
  process.stdout.write(
    `\nNo essay matches ${pad3(episodeNo)}-*.mdx — paste this URL into the frontmatter manually:\n  ${publicUrl}\n`,
  );
  process.exit(0);
}

const relPath = relative(PROJECT_ROOT, essayPath);
const ok = await confirm(`About to update ${relPath} with audio_url. Continue?`);
if (!ok) {
  process.stdout.write(`Skipped frontmatter + commit. URL still live at: ${publicUrl}\n`);
  process.exit(0);
}

const fmResult = updateFrontmatter(essayPath, publicUrl);
if (fmResult === "unchanged") {
  process.stdout.write(`audio_url already set to this URL — no frontmatter change.\n`);
} else {
  process.stdout.write(`${fmResult === "inserted" ? "Inserted" : "Updated"} audio_url in ${relPath}\n`);
}

const commitResult = gitStageAndCommit(essayPath, pad3(episodeNo));
if (commitResult === "committed") {
  process.stdout.write(`\nCommitted locally. Run \`git push origin main\` to deploy.\n`);
} else {
  process.stdout.write(`\nNo changes to commit (audio_url already matched). Upload complete.\n`);
}
