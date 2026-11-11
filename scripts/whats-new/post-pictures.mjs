#!/usr/bin/env node
// #443 What's New pictures for a PR whose note is already posted (it went live before pictures
// existed, or its pictures failed to upload). Reads docs/whats-new/<pr>/ like post-whats-new.mjs,
// uploads each picture and posts them in What's New as one message (two past 3 pictures) under the
// PR's note text. Once per PR: a second run is refused by the server.
//
//   node scripts/whats-new/post-pictures.mjs <pr-number>
//
//   WHATS_NEW_TOKEN          the shared secret (GitHub secret; never printed)
//   WHATS_NEW_URL            default https://chat.robbooker.com/api/chat/whats-new
//   WHATS_NEW_PICTURES_DIR   default docs/whats-new
//   DRY_RUN=1                list the pictures and captions, post nothing
// Also runs from GitHub: Actions > What's New notes > Run workflow, with "pictures_for_pr" set.
import { readPictures, uploadPicture } from "./post-whats-new.mjs";

export async function postPictures({ pr, dir, url, token, fetchImpl = fetch, log = () => {} }) {
  const { pictures, problems } = await readPictures(dir, pr);
  for (const problem of problems) log(`warning: ${problem}`);
  if (!pictures.length) throw new Error(`No pictures for #${pr} in ${dir}/${pr}.`);
  const ids = [];
  for (const picture of pictures) {
    ids.push(await uploadPicture({ url, token, pr, picture, followUp: true, fetchImpl }));
    log(`uploaded ${picture.file} ("${picture.caption}")`);
  }
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ followUp: { pr, pictures: ids } }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Posting the pictures failed (${response.status}): ${result.error ?? "unknown"}`);
  return result;
}

async function main() {
  const env = process.env;
  const arg = process.argv[2] ?? env.PICTURES_FOR_PR ?? "";
  if (!/^\d{1,10}$/.test(arg) || Number(arg) < 1) throw new Error("Usage: post-pictures.mjs <pr-number>");
  const pr = Number(arg);
  const dir = env.WHATS_NEW_PICTURES_DIR || "docs/whats-new";
  if (env.DRY_RUN === "1") {
    const { pictures, problems } = await readPictures(dir, pr);
    for (const picture of pictures)
      console.log(`#${pr} picture ${picture.file}: "${picture.caption}" (${Math.ceil(picture.bytes.length / 1000)} KB)`);
    for (const problem of problems) console.log(`warning: ${problem}`);
    console.log(pictures.length ? "DRY_RUN=1: not posting." : `No pictures for #${pr} in ${dir}/${pr}.`);
    return;
  }
  if (!env.WHATS_NEW_TOKEN) throw new Error("WHATS_NEW_TOKEN is not set.");
  const result = await postPictures({
    pr,
    dir,
    url: env.WHATS_NEW_URL || "https://chat.robbooker.com/api/chat/whats-new",
    token: env.WHATS_NEW_TOKEN,
    log: console.log,
  });
  console.log(`Posted ${result.pictures} picture(s) for #${pr} in ${result.messageIds.length} message(s): ${result.messageIds.join(", ")}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
