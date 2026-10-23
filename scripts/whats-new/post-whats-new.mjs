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
// No npm install needed (Node 20+ fetch only).

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
  for (const change of changes) console.log(`#${change.pr}: ${change.note}`);
  if (env.DRY_RUN === "1") {
    console.log("DRY_RUN=1: not posting.");
    return;
  }
  if (!env.WHATS_NEW_TOKEN) throw new Error("WHATS_NEW_TOKEN is not set (GitHub Actions secret).");
  const result = await postChanges({
    url: env.WHATS_NEW_URL || "https://chat.robbooker.com/api/chat/whats-new",
    token: env.WHATS_NEW_TOKEN,
    sha,
    changes,
  });
  console.log(
    result.posted
      ? `Posted note ${result.messageId} for ${result.announced.map((n) => `#${n}`).join(", ")}.`
      : "Every change here was already announced; nothing new to post.",
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
