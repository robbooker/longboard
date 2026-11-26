// #524: the recording of a room's live video, linked from its ended notice. The pure rules: which
// link is taken, which broadcast a post in a recordings room belongs to. No database here
// (lib/chatStageRecordingServer.ts); the words are lib/chatStageNotice.ts.
import { recordingVideoFromUrl, type RecordingVideo } from "./chatRecordingVideos";
import { STAGE_NOTICE_BOT, STAGE_RECORDING_LABEL, stageEndedNotice } from "./chatStageNotice";
import { tokenizeChatMessage, type ChatRoom } from "./publicChat";

/**
 * A recording's link as it is stored and shown: built from the checked video id on a fixed host
 * (lib/chatRecordingVideos.ts's own check), so nothing else of what was pasted is kept. null for
 * anything that is not a YouTube or Loom video link.
 */
export function stageRecordingUrl(value: unknown): string | null {
  const video = typeof value === "string" && value.length <= 500 ? recordingVideoFromUrl(value) : null;
  if (!video) return null;
  if (video.kind === "loom") return `https://www.loom.com/share/${video.id}`;
  return `https://www.youtube.com/watch?v=${video.id}${video.start ? `&t=${video.start}s` : ""}`;
}

/**
 * The player card under an ended notice that carries a recording. Only Longboard Bot's ended notice
 * gets one, and only for a link that passes the same check as the recordings rooms: nothing else
 * posted in an ordinary room is ever given a player.
 */
export function stageRecordingVideos(botSlug: string | null | undefined, body: string): RecordingVideo[] {
  if (botSlug !== STAGE_NOTICE_BOT || !body.startsWith("The live video in ")) return [];
  const url = stageEndedNotice(body)?.recordingUrl;
  const video = url ? recordingVideoFromUrl(url) : null;
  return video ? [{ ...video, title: STAGE_RECORDING_LABEL }] : [];
}

/**
 * Whose recordings a recordings room holds: LB Recordings is LB's, SS Recordings is SS's. No other
 * room is guessed at (Social is both LB and SS; Booker Stock Club has no recordings room): there an
 * admin adds the link by hand.
 */
const RECORDINGS_OF: Partial<Record<ChatRoom, ChatRoom>> = { "lb-recordings": "main", "ss-recordings": "shortscout" };

/** A post in a recordings room: the room it is a recording for and its first YouTube or Loom link. null: nothing to attach. */
export function stageRecordingFromPost(postRoom: ChatRoom, body: string): { room: ChatRoom; url: string } | null {
  const room = RECORDINGS_OF[postRoom];
  if (!room || !/youtu|loom/i.test(body)) return null;
  for (const part of tokenizeChatMessage(body)) {
    const url = part.kind === "text" ? null : stageRecordingUrl(part.href);
    if (url) return { room, url };
  }
  return null;
}

/**
 * How long after a broadcast began a post in the recordings room is still taken to be its
 * recording. The team posts the link the same day or the next morning; 36 hours covers an evening
 * webinar posted the next morning and stops short of a recording posted two days later (by then it
 * is more likely to be something else, and an admin can still add it by hand).
 */
export const STAGE_RECORDING_WINDOW_MS = 36 * 60 * 60_000;

/**
 * Whether a recording posted at `postedAt` goes onto this broadcast, the room's most recent one:
 * it has ended, nobody has set or removed a recording on it (the first link wins; an admin's choice
 * stands), and the post came after it began and within the window.
 */
export function stageRecordingFits(
  broadcast: { startedAt: number; endedAt: number | null; recordingUrl: string | null; recordingSource: string | null } | null,
  postedAt: number,
): boolean {
  if (!broadcast || broadcast.endedAt === null || broadcast.recordingUrl || broadcast.recordingSource) return false;
  return postedAt >= broadcast.startedAt && postedAt - broadcast.startedAt <= STAGE_RECORDING_WINDOW_MS;
}
