#!/usr/bin/env node
// Longboard — episode ingestion pipeline. Phase 3N.
//
// Usage:
//   npm run ingest-episode -- --file <path> --episode <N> [--model <name>]
//   npm run ingest-episode -- --help
//
// Transcribes audio via whisper-cli, rewrites via Claude API, writes
// draft + transcript to content/drafts/.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, extname, join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import { rewriteTranscript } from "./lib/rewrite.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const DRAFTS_DIR = join(PROJECT_ROOT, "content", "drafts");
const DEFAULT_MODEL_PATH = join(process.env.HOME || "~", ".whisper", "ggml-base.en.bin");
const SUPPORTED_EXTS = new Set([".m4a", ".wav", ".mp3", ".mp4"]);

function fail(msg) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

function pad3(n) {
  return String(n).padStart(3, "0");
}

function requireBinary(name) {
  try {
    execFileSync("which", [name], { stdio: "ignore" });
  } catch {
    fail(`${name} not installed. Run: brew install ${name === "whisper-cli" ? "whisper-cpp" : name}`);
  }
}

const program = new Command();
program
  .name("ingest-episode")
  .description("Transcribe an audio file and rewrite as a Longboard essay draft in Levine voice.")
  .requiredOption("--file <path>", "input audio file (.m4a, .wav, .mp3, .mp4)")
  .requiredOption("--episode <N>", "episode number (1-999)", (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 999) fail(`--episode must be 1..999, got ${v}`);
    return n;
  })
  .option("--model <path>", `whisper model path (default: ${DEFAULT_MODEL_PATH})`, DEFAULT_MODEL_PATH)
  .helpOption("-h, --help", "show this help");

program.parse(process.argv);
const opts = program.opts();

// ── Validation ────────────────────────────────────────────
requireBinary("whisper-cli");
requireBinary("ffmpeg");

if (!process.env.ANTHROPIC_API_KEY) fail("ANTHROPIC_API_KEY not set (expected in .env.local)");

const inputPath = resolve(opts.file);
if (!existsSync(inputPath)) fail(`File not found: ${opts.file}`);
const ext = extname(inputPath).toLowerCase();
if (!SUPPORTED_EXTS.has(ext)) fail(`Unsupported input: expected .m4a/.wav/.mp3/.mp4, got ${ext}`);

const modelPath = resolve(opts.model);
if (!existsSync(modelPath)) fail(`Whisper model not found at ${modelPath}. Download: curl -L -o ~/.whisper/ggml-base.en.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin`);

const episodeNo = opts.episode;
const padded = pad3(episodeNo);
mkdirSync(DRAFTS_DIR, { recursive: true });

process.stdout.write(
  [
    `Input:    ${inputPath}`,
    `Episode:  ${episodeNo} (${padded})`,
    `Model:    ${basename(modelPath)}`,
    "",
  ].join("\n"),
);

// ── Step 1: Convert to 16kHz mono WAV (whisper-cli requirement) ───
const wavPath = join(DRAFTS_DIR, `${padded}-temp.wav`);
process.stdout.write("Converting to 16kHz WAV...\n");
const ffResult = spawnSync("ffmpeg", ["-y", "-i", inputPath, "-ar", "16000", "-ac", "1", "-f", "wav", wavPath], {
  stdio: ["ignore", "ignore", "pipe"],
});
if (ffResult.status !== 0) {
  const err = ffResult.stderr ? ffResult.stderr.toString().split("\n").filter(Boolean).pop() : "unknown";
  fail(`ffmpeg conversion failed: ${err}`);
}

// ── Step 2: Transcribe via whisper-cli ────────────────────
const transcriptBase = join(DRAFTS_DIR, `${padded}-transcript`);
process.stdout.write("Transcribing...\n");
const whisperResult = spawnSync("whisper-cli", [
  "-m", modelPath,
  "-f", wavPath,
  "--no-timestamps",
  "-otxt",
  "-of", transcriptBase,
], { stdio: ["ignore", "pipe", "pipe"] });

// Clean up temp WAV regardless of outcome.
try { execFileSync("rm", [wavPath]); } catch {}

if (whisperResult.status !== 0) {
  const err = whisperResult.stderr ? whisperResult.stderr.toString().split("\n").filter(Boolean).pop() : "unknown";
  fail(`whisper-cli failed: ${err}`);
}

const transcriptPath = `${transcriptBase}.txt`;
if (!existsSync(transcriptPath)) fail("whisper-cli produced no output file");

const transcript = readFileSync(transcriptPath, "utf8").trim();
const wordCount = transcript.split(/\s+/).length;
process.stdout.write(`Transcribed: ${wordCount} words → ${transcriptPath}\n`);

// ── Step 3: Rewrite via Claude API ────────────────────────
const essay = await rewriteTranscript(transcript, { episode: episodeNo });

const draftPath = join(DRAFTS_DIR, `${padded}-draft.md`);
writeFileSync(draftPath, essay);
process.stdout.write(`Draft written: ${draftPath}\n`);

// ── Summary ───────────────────────────────────────────────
// Extract title from the draft frontmatter for the summary line.
const titleMatch = essay.match(/^title:\s*"?([^"\n]+)"?\s*$/m);
const title = titleMatch ? titleMatch[1] : "(untitled)";

process.stdout.write(
  [
    "",
    "──────────────────────────────────────────",
    `  Issue ${padded}: ${title}`,
    `  Transcript: ${transcriptPath}`,
    `  Draft:      ${draftPath}`,
    "──────────────────────────────────────────",
    "",
    "Review the draft, edit if needed, then run:",
    `  npm run publish-episode -- --episode ${episodeNo}`,
    "",
  ].join("\n"),
);
