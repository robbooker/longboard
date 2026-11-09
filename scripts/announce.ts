// #413: post an announcement as "Longboard Bot" from the command line (the ops session), the same way
// POST /api/chat/admin/announce does: public.post_chat_longboard_announcement with the service role,
// then a realtime nudge to each room that got a new post.
//
//   npm run chat:announce -- --rooms all --body "Text"            every room except Gainers
//   npm run chat:announce -- --rooms main,social --file note.txt  some rooms, text from a file
//   npm run chat:announce -- --rooms all --body "Text" --dry-run  list the rooms, post nothing
//
// --id <uuid> names the announcement. Without it the text names it, so running the same command again
// posts nothing new (each room answers "duplicate"); pass a new --id to post the same words again.
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (read from .env.local when present).
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { CHAT_ROOMS } from "@/lib/publicChat";
import { ANNOUNCE_EXCLUDED_ROOMS, parseAnnouncementRequest, postAnnouncement } from "@/lib/chatLongboardBot";
import { publishRoomEvent } from "@/lib/chatRealtimePublish";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const roomsArg = arg("rooms") ?? "all";
  const file = arg("file");
  const body = file ? await readFile(file, "utf8") : arg("body");
  const parsed = parseAnnouncementRequest({
    rooms: roomsArg === "all" ? "all" : roomsArg.split(",").map((room) => room.trim()).filter(Boolean),
    body,
    clientId: arg("id"),
  });
  if (!parsed.ok) {
    console.error(`announce: ${parsed.error}`);
    console.error(`rooms: all, or a comma list of ${CHAT_ROOMS.map((room) => room.slug).join(", ")} (not ${ANNOUNCE_EXCLUDED_ROOMS.join(", ")})`);
    process.exit(2);
  }
  const { rooms, clientId } = parsed.value;
  console.log(`Longboard Bot announcement ${clientId}`);
  console.log(`rooms (${rooms.length}): ${rooms.join(", ")}`);
  if (dryRun) {
    console.log("---");
    console.log(parsed.value.body);
    console.log("--- dry run: nothing posted");
    return;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("announce: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
    process.exit(2);
  }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const results = await postAnnouncement(db, parsed.value);
  for (const result of results) {
    console.log(`${result.room.padEnd(18)} ${result.status}${result.error ? ` (${result.error})` : ""} ${result.messageId}`);
    if (result.status === "posted") await publishRoomEvent(result.room, { kind: "changed", topics: ["history"] });
  }
  if (results.some((result) => result.status === "failed")) process.exit(1);
}

main().catch((error) => {
  console.error("announce: failed", error instanceof Error ? error.message : error);
  process.exit(1);
});
