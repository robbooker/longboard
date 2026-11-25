import { isRecordingRoom, tokenizeChatMessage, type ChatRoom } from "./publicChat";

/**
 * #513: recordings posted in the two recordings rooms play inside chat. A player address is only
 * ever built here, from a checked video id on a fixed host; nothing else of the posted link is used.
 */
export type RecordingVideo = {
  kind: "youtube" | "loom";
  id: string;
  /** Seconds into the video (YouTube links with t= or start=). */
  start: number;
  /** The player's address, loaded only after the member presses play. */
  embedUrl: string;
  /** "YouTube video" / "Loom video". */
  label: string;
  /** The words in front of the link on its line ("11/25/26 | LONGBOARD WEBINAR"), when there are any. */
  title: string;
};

export const RECORDING_VIDEO_LIMIT = 3;

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
const LOOM_HOSTS = new Set(["loom.com", "www.loom.com"]);
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const LOOM_ID = /^[0-9a-f]{32}$/;

/** "90", "90s", "1m30s", "1h2m3s" -> seconds; anything else -> 0. */
function startSeconds(value: string | null) {
  const match = value?.match(/^(?:(\d{1,2})h)?(?:(\d{1,3})m)?(?:(\d{1,6})s?)?$/);
  if (!match || !match[0]) return 0;
  const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return seconds > 0 && seconds < 360000 ? seconds : 0;
}

export function recordingVideoFromUrl(value: string): Omit<RecordingVideo, "title"> | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/\/$/, "");
  if (host === "youtu.be" || YOUTUBE_HOSTS.has(host) || host === "www.youtube-nocookie.com") {
    const id =
      host === "youtu.be"
        ? path.slice(1)
        : path === "/watch"
          ? url.searchParams.get("v")
          : host === "www.youtube-nocookie.com"
            ? path.match(/^\/embed\/([^/]+)$/)?.[1]
            : path.match(/^\/(?:live|shorts|embed)\/([^/]+)$/)?.[1];
    // "videoseries" is YouTube's playlist player, which happens to be shaped like an id.
    if (!id || !YOUTUBE_ID.test(id) || id === "videoseries") return null;
    const start = startSeconds(url.searchParams.get("t")) || startSeconds(url.searchParams.get("start"));
    return {
      kind: "youtube",
      id,
      start,
      embedUrl: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0${start ? `&start=${start}` : ""}`,
      label: "YouTube video",
    };
  }
  if (LOOM_HOSTS.has(host)) {
    const id = path.match(/^\/(?:share|embed)\/([^/]+)$/)?.[1];
    if (!id || !LOOM_ID.test(id)) return null;
    return { kind: "loom", id, start: 0, embedUrl: `https://www.loom.com/embed/${id}?autoplay=1`, label: "Loom video" };
  }
  return null;
}

/** The videos to offer under a message: none outside the recordings rooms, one per video, three at most. */
export function recordingVideosFromText(room: ChatRoom, body: string): RecordingVideo[] {
  if (!isRecordingRoom(room) || !/youtu|loom/i.test(body)) return [];
  const videos: RecordingVideo[] = [];
  let line = "";
  for (const part of tokenizeChatMessage(body)) {
    if (part.kind === "text") {
      const lines = part.value.split("\n");
      line = lines.length > 1 ? lines[lines.length - 1] : line + part.value;
      continue;
    }
    const video = recordingVideoFromUrl(part.href);
    if (video && !videos.some((other) => other.kind === video.kind && other.id === video.id)) {
      const title = line.replace(/[\s:|–—-]+$/, "").trim().slice(0, 140);
      videos.push({ ...video, title });
      if (videos.length === RECORDING_VIDEO_LIMIT) break;
    }
    line = "";
  }
  return videos;
}
