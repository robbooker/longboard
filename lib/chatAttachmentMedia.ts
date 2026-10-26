import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * MEDIA-SIZE: what a message needs to reserve its attachment boxes before any file details
 * or image bytes load. Read paths attach this to each message (`attachment_media`), so the
 * first paint already has the final box and nothing grows after it appears.
 * Dimensions are server-trusted: read by sharp from the scanned file (width/height) or from
 * the server-made preview (preview_width/height, same shape). Layout only, never security.
 */
export type ChatAttachmentMedia =
  { kind: "image"; width: number | null; height: number | null } | { kind: "audio" } | { kind: "file" };
export type ChatAttachmentMediaMap = Record<string, ChatAttachmentMedia>;

/** File chip size: "1 KB" at least (never "0 KB"), MB from 1 MB. Rooms and DMs share it. */
export const attachmentSizeLabel = (bytes: number) =>
  bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.ceil(bytes / 1000))} KB`;

/** The image box inside a room/DM attachment card (the card is 320px wide, border-box). */
export const MEDIA_FRAME_MAX_WIDTH = 302;
export const MEDIA_FRAME_MAX_HEIGHT = 220;
const MIN_SIDE = 44;
const MAX_SIDE = 20_000;

const side = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_SIDE ? value : null;

/** Validated pixel size, or null (older files and anything out of range). */
export function mediaDimensions(width: unknown, height: unknown): [number, number] | null {
  const w = side(width),
    h = side(height);
  return w && h ? [w, h] : null;
}

/**
 * The reserved box for an image: fits inside 302×220 without enlarging, keeps a 44px tap
 * target. Files without dimensions get the fixed 302×220 box (the image is letterboxed
 * inside it), so they never jump either.
 */
export function mediaFrame(width?: number | null, height?: number | null) {
  const dims = mediaDimensions(width, height);
  if (!dims) return { width: MEDIA_FRAME_MAX_WIDTH, height: MEDIA_FRAME_MAX_HEIGHT, sized: false };
  const ratio = dims[0] / dims[1];
  const w = Math.min(MEDIA_FRAME_MAX_WIDTH, dims[0], MEDIA_FRAME_MAX_HEIGHT * ratio);
  return {
    width: Math.max(MIN_SIDE, Math.round(w)),
    height: Math.max(MIN_SIDE, Math.round(w / ratio)),
    sized: true,
  };
}

/** Inline style for the reserved box: explicit width, height from the ratio when narrow. */
export function mediaFrameStyle(width?: number | null, height?: number | null) {
  const frame = mediaFrame(width, height);
  return {
    width: frame.width,
    maxWidth: "100%",
    aspectRatio: `${frame.width} / ${frame.height}`,
    height: "auto",
  } as const;
}

export function mediaKind(mime: unknown): ChatAttachmentMedia["kind"] {
  return typeof mime === "string" && mime.startsWith("image/")
    ? "image"
    : mime === "audio/wav"
      ? "audio"
      : "file";
}

type MediaRow = {
  id: string;
  mime_type: string;
  width?: number | null;
  height?: number | null;
  preview_width?: number | null;
  preview_height?: number | null;
};

/** Original size first (written at scan time), then the server-made preview's size. */
export function mediaFromRow(row: MediaRow): ChatAttachmentMedia {
  const kind = mediaKind(row.mime_type);
  if (kind !== "image") return { kind };
  const dims =
    mediaDimensions(row.width, row.height) ?? mediaDimensions(row.preview_width, row.preview_height);
  return { kind, width: dims?.[0] ?? null, height: dims?.[1] ?? null };
}

// The width/height columns arrive with 20261016120000_chat_attachment_dimensions.sql. Until
// that migration is applied the read falls back to the preview columns (which already exist),
// rechecking now and then so a deploy is not needed once it lands.
let dimensionColumnsMissingUntil = 0;
const BASE_COLUMNS = "id,mime_type,preview_width,preview_height";

export type AttachmentMediaScope = { room: string } | { conversationId: string };

/** Best-effort: returns null on any failure so callers keep the old (unsized) behaviour. */
export async function readAttachmentMedia(
  db: SupabaseClient,
  scope: AttachmentMediaScope,
  ids: string[],
): Promise<ChatAttachmentMediaMap | null> {
  const unique = [...new Set(ids)];
  if (!unique.length) return {};
  const chunk = async (part: string[]) => {
    const query = (columns: string) =>
      db
        .from("chat_attachments")
        .select(columns)
        .eq(
          "conversationId" in scope ? "conversation_id" : "room_slug",
          "conversationId" in scope ? scope.conversationId : scope.room,
        )
        .eq("status", "attached")
        .in("id", part);
    if (Date.now() >= dimensionColumnsMissingUntil) {
      const full = await query(`${BASE_COLUMNS},width,height`);
      if (!full.error) return full.data as unknown as MediaRow[];
      dimensionColumnsMissingUntil = Date.now() + 10 * 60_000;
    }
    const base = await query(BASE_COLUMNS);
    if (base.error) throw base.error;
    return base.data as unknown as MediaRow[];
  };
  try {
    const parts: string[][] = [];
    for (let i = 0; i < unique.length; i += 100) parts.push(unique.slice(i, i + 100));
    const rows = (await Promise.all(parts.map(chunk))).flat();
    return Object.fromEntries(rows.map((row) => [row.id, mediaFromRow(row)]));
  } catch {
    return null;
  }
}

type WithAttachments = {
  id: string;
  attachment_ids?: string[] | null;
  deleted_at?: string | null;
  removed?: boolean | null;
};

/** Per-message media for the messages that show files. Never fails: empty on any error. */
export async function messageAttachmentMedia(
  db: SupabaseClient,
  scope: AttachmentMediaScope,
  messages: WithAttachments[],
): Promise<Map<string, ChatAttachmentMediaMap>> {
  const out = new Map<string, ChatAttachmentMediaMap>();
  const shown = messages.filter((m) => !m.deleted_at && !m.removed && Array.isArray(m.attachment_ids));
  const ids = shown.flatMap((m) => m.attachment_ids!);
  if (!ids.length) return out;
  const media = await readAttachmentMedia(db, scope, ids);
  if (!media) return out;
  for (const m of shown) {
    const own = Object.fromEntries(m.attachment_ids!.flatMap((id) => (media[id] ? [[id, media[id]]] : [])));
    if (Object.keys(own).length) out.set(m.id, own);
  }
  return out;
}

/** Puts `attachment_media` on the rows it was read for (run the read alongside other reads). */
export function applyAttachmentMedia<T extends { id: string }>(
  messages: T[],
  media: Map<string, ChatAttachmentMediaMap>,
): Array<T & { attachment_media?: ChatAttachmentMediaMap }> {
  if (!media.size) return messages;
  return messages.map((m) => (media.has(m.id) ? { ...m, attachment_media: media.get(m.id) } : m));
}

export async function withAttachmentMedia<T extends WithAttachments>(
  db: SupabaseClient,
  scope: AttachmentMediaScope,
  messages: T[],
) {
  return applyAttachmentMedia(messages, await messageAttachmentMedia(db, scope, messages));
}
