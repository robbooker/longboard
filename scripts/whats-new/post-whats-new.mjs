#!/usr/bin/env node
// #302 What's New: after a production deploy, post one plain-English note to the What's New
// room for the user-visible PRs that just went live.
//
// A PR is user-visible when its description has a "What's New:" line (see CLAUDE.md). PRs
// without one are behind-the-scenes and are skipped. Every PR merged in the last LOOKBACK_DAYS
// whose merge commit is part of the deployed commit is sent; the server leaves out the ones it
// already announced, so this can run again for the same (or a later) deploy without repeats.
//
//   GITHUB_TOKEN, GITHUB_REPOSITORY, DEPLOY_SHA   from the workflow
//   WHATS_NEW_TOKEN                               the shared secret (GitHub secret)
//   WHATS_NEW_URL                                 default https://chat.robbooker.com/api/chat/whats-new
//   DRY_RUN=1                                     print what would be sent, post nothing
//   WHATS_NEW_PICTURES_DIR                        default docs/whats-new (#443, see CLAUDE.md)
// No npm install needed (Node 20+ fetch only).
//
// #443 pictures: a PR may commit up to 4 "after" pictures (PNG or JPEG, at most 600 KB each) in
// docs/whats-new/<pr-number>/, with an optional captions.json ({"file.png": "Caption"}); without
// one the caption comes from the file name. Each picture is uploaded to /api/chat/whats-new/pictures
// and the note carries them. A picture that can't be read or uploaded is reported and left out;
// the note itself still goes out.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export const MAX_PICTURES = 4;
export const MAX_PICTURE_BYTES = 600_000;
const PICTURE_FILE = /\.(png|jpe?g)$/i;

const NOTE_LINE = /^\s*(?:[-*>]\s*)?(?:\*\*|__)?\s*what[’'`]?s\s+new\s*(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*(.*)$/i;
const SKIP_WORDS = /^(?:none|n\/?a|nothing|no|-+|—|behind[- ]the[- ]scenes\.?|internal\.?|skip\.?)$/i;

/** The plain-English note from a PR description, or null when it has none (behind-the-scenes). */
export function whatsNewNote(body) {
  if (typeof body !== "string" || !body) return null;
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) inFence = !inFence;
    if (inFence) continue;
    const match = lines[i].match(NOTE_LINE);
    if (!match) continue;
    // The note is the rest of the line, or the next lines up to a blank line when it starts below.
    const parts = [match[1]];
    if (!match[1].trim())
      for (let j = i + 1; j < lines.length && lines[j].trim() && !/^\s*#/.test(lines[j]); j++) parts.push(lines[j]);
    const note = plain(parts.join(" "));
    if (!note || SKIP_WORDS.test(note)) return null;
    return note;
  }
  return null;
}

function plain(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|`)/g, "")
    .replace(/(^|\s)[*_](\S[^*_]*\S|\S)[*_](?=\s|[.,!?]|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The user-visible PRs in a deploy. `github(path)` returns parsed JSON from the GitHub REST API.
 * Returns { changes, skipped } where skipped lists behind-the-scenes PR numbers.
 */
export async function collectChanges({ github, sha, now = Date.now(), lookbackDays = 14 }) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("DEPLOY_SHA must be a full commit SHA");
  const deployed = new Set();
  for (let page = 1; page <= 3; page++) {
    const commits = await github(`commits?sha=${sha}&per_page=100&page=${page}`);
    for (const commit of commits) deployed.add(commit.sha);
    if (commits.length < 100) break;
  }
  const since = now - lookbackDays * 86400_000;
  const changes = [];
  const skipped = [];
  for (let page = 1; page <= 3; page++) {
    const pulls = await github(`pulls?state=closed&base=main&sort=updated&direction=desc&per_page=100&page=${page}`);
    for (const pr of pulls) {
      if (!pr.merged_at || Date.parse(pr.merged_at) < since || !deployed.has(pr.merge_commit_sha)) continue;
      const note = whatsNewNote(pr.body);
      if (note) changes.push({ pr: pr.number, note, mergedAt: pr.merged_at });
      else skipped.push(pr.number);
    }
    // Sorted by last update: once a whole page is older than the window, later pages are too.
    if (pulls.length < 100 || pulls.every((pr) => Date.parse(pr.updated_at) < since)) break;
  }
  changes.sort((a, b) => Date.parse(a.mergedAt) - Date.parse(b.mergedAt) || a.pr - b.pr);
  return { changes, skipped: skipped.sort((a, b) => a - b) };
}

export async function postChanges({ url, token, sha, changes, fetchImpl = fetch }) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ deployment: sha, changes }),
  });
  const text = await response.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    result = { error: text.slice(0, 200) };
  }
  if (!response.ok) throw new Error(`What's New post failed (${response.status}): ${result.error ?? "unknown"}`);
  return result;
}

/** "2-pink-theme_on-a-phone.png" -> "Pink theme on a phone". */
export function captionFromFile(file) {
  const words = file
    .replace(/\.[^.]+$/, "")
    .replace(/^\d+[\s._-]*/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "";
}

const pictureType = (bytes) =>
  bytes.length > 8 && bytes[0] === 0x89 && bytes.toString("latin1", 1, 4) === "PNG"
    ? "image/png"
    : bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      ? "image/jpeg"
      : null;

/**
 * The pictures committed for one PR: { pictures: [{ file, caption, mime, bytes }], problems }.
 * Sorted by file name, at most MAX_PICTURES; anything wrong is a problem, never a crash.
 */
export async function readPictures(dir, pr) {
  const folder = join(dir, String(pr));
  let files;
  try {
    files = (await readdir(folder)).sort();
  } catch {
    return { pictures: [], problems: [] };
  }
  const problems = [];
  let captions = {};
  if (files.includes("captions.json"))
    try {
      const parsed = JSON.parse(await readFile(join(folder, "captions.json"), "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) captions = parsed;
      else problems.push("captions.json is not an object of file name to caption");
    } catch {
      problems.push("captions.json is not valid JSON");
    }
  const candidates = files.filter((file) => PICTURE_FILE.test(file));
  for (const file of files)
    if (file !== "captions.json" && !PICTURE_FILE.test(file)) problems.push(`${file}: not a PNG or JPEG, skipped`);
  if (candidates.length > MAX_PICTURES)
    problems.push(`${candidates.length} pictures; only the first ${MAX_PICTURES} are used`);
  const pictures = [];
  for (const file of candidates.slice(0, MAX_PICTURES)) {
    const bytes = await readFile(join(folder, file));
    const mime = pictureType(bytes);
    if (!mime) problems.push(`${file}: not a PNG or JPEG inside, skipped`);
    else if (bytes.length > MAX_PICTURE_BYTES)
      problems.push(`${file}: ${Math.ceil(bytes.length / 1000)} KB is over ${MAX_PICTURE_BYTES / 1000} KB, skipped`);
    else {
      const caption = typeof captions[file] === "string" && captions[file].trim() ? captions[file].trim() : captionFromFile(file);
      pictures.push({ file, caption, mime, bytes });
    }
  }
  return { pictures, problems };
}

/** Uploads one picture; returns its id. followUp: the PR's note is already posted. */
export async function uploadPicture({ url, token, pr, picture, followUp = false, fetchImpl = fetch }) {
  const target = new URL(url.replace(/\/$/, "") + "/pictures");
  target.searchParams.set("pr", String(pr));
  target.searchParams.set("caption", picture.caption);
  if (followUp) target.searchParams.set("followUp", "1");
  const response = await fetchImpl(target, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": picture.mime },
    body: picture.bytes,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`picture ${picture.file} failed (${response.status}): ${result.error ?? "unknown"}`);
    error.code = result.error;
    throw error;
  }
  return result.id;
}

/**
 * Uploads each change's pictures and sets change.pictures to their ids. A PR whose pictures
 * can't go up still gets its text; the reasons come back in `problems`.
 */
export async function attachPictures({ changes, dir, url, token, fetchImpl = fetch, log = () => {} }) {
  const problems = [];
  for (const change of changes) {
    const found = await readPictures(dir, change.pr);
    problems.push(...found.problems.map((problem) => `#${change.pr} ${problem}`));
    const ids = [];
    for (const picture of found.pictures) {
      try {
        ids.push(await uploadPicture({ url, token, pr: change.pr, picture, fetchImpl }));
        log(`#${change.pr}: uploaded ${picture.file} ("${picture.caption}")`);
      } catch (error) {
        problems.push(`#${change.pr} ${error.message}`);
        if (error.code === "already_announced" || error.code === "pictures_already_posted") break;
      }
    }
    if (ids.length) change.pictures = ids;
  }
  return problems;
}

async function main() {
  const env = process.env;
  const repo = env.GITHUB_REPOSITORY;
  const sha = (env.DEPLOY_SHA || "").trim();
  if (!repo || !env.GITHUB_TOKEN) throw new Error("GITHUB_REPOSITORY and GITHUB_TOKEN are required");
  const github = async (path) => {
    const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
      headers: {
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
    });
    if (!response.ok) throw new Error(`GitHub ${path.split("?")[0]} failed: ${response.status}`);
    return response.json();
  };
  const { changes, skipped } = await collectChanges({
    github,
    sha,
    lookbackDays: Number(env.LOOKBACK_DAYS) > 0 ? Number(env.LOOKBACK_DAYS) : 14,
  });
  console.log(`Behind-the-scenes PRs skipped: ${skipped.length ? skipped.map((n) => `#${n}`).join(", ") : "none"}`);
  if (!changes.length) {
    console.log("No user-visible changes in this deploy; nothing to post.");
    return;
  }
  const dir = env.WHATS_NEW_PICTURES_DIR || "docs/whats-new";
  for (const change of changes) {
    const { pictures, problems } = await readPictures(dir, change.pr);
    console.log(`#${change.pr}: ${change.note}`);
    for (const picture of pictures) console.log(`  picture ${picture.file}: "${picture.caption}"`);
    for (const problem of problems) console.log(`  warning: ${problem}`);
  }
  if (env.DRY_RUN === "1") {
    console.log("DRY_RUN=1: not posting.");
    return;
  }
  if (!env.WHATS_NEW_TOKEN) throw new Error("WHATS_NEW_TOKEN is not set (GitHub Actions secret).");
  const url = env.WHATS_NEW_URL || "https://chat.robbooker.com/api/chat/whats-new";
  const problems = await attachPictures({ changes, dir, url, token: env.WHATS_NEW_TOKEN, log: console.log });
  for (const problem of problems) console.log(`Picture left out: ${problem}`);
  const result = await postChanges({ url, token: env.WHATS_NEW_TOKEN, sha, changes });
  console.log(
    result.posted
      ? `Posted note ${result.messageId} for ${result.announced.map((n) => `#${n}`).join(", ")}` +
          (result.pictures ? ` with ${result.pictures} picture${result.pictures === 1 ? "" : "s"}.` : ".")
      : "Every change here was already announced; nothing new to post.",
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
