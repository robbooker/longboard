import { voiceDuration, VOICE_MAX_BYTES } from "./chatVoice";
export const CHAT_FILE_MAX_BYTES = 10_000_000;
export const CHAT_FILE_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "audio/wav",
  "text/html",
] as const;
export type ChatFileType = (typeof CHAT_FILE_TYPES)[number];
/** Where a file is being shared. Rooms are public to many members; DMs are between two people. */
export type ChatFileScope = "room" | "dm";
/**
 * HTML can run scripts, so it is accepted in private DMs only (the database enforces the
 * same rule) and is never shown inline anywhere: recipients only ever get a download.
 */
export const DM_ONLY_FILE_TYPES: readonly ChatFileType[] = ["text/html"];
export const isHtmlAttachment = (mime: unknown) => mime === "text/html";
export type ChatAttachmentScope = { room: string };
export type ChatAttachment = {
  id: string;
  filename: string;
  byte_size: number;
  mime_type: ChatFileType;
  preview_width?: number | null;
  preview_height?: number | null;
  width?: number | null;
  height?: number | null;
  thumbnail_available?: boolean;
  duration_seconds?: number | null;
};
const extensions: Record<ChatFileType, string[]> = {
  "application/pdf": ["pdf"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/gif": ["gif"],
  "audio/wav": ["wav"],
  "text/html": ["html", "htm"],
};
/** File-picker filter for the composer: rooms never offer HTML. */
export function attachmentAccept(scope: ChatFileScope = "room") {
  return CHAT_FILE_TYPES.filter((type) => scope === "dm" || !DM_ONLY_FILE_TYPES.includes(type))
    .flatMap((type) => extensions[type].map((extension) => `.${extension}`))
    .join(",");
}
export function attachmentTypesError(scope: ChatFileScope = "room") {
  return scope === "dm"
    ? "Choose a PDF, JPEG, PNG, GIF, HTML or WAV voice file."
    : "Choose a PDF, JPEG, PNG, GIF or WAV voice file.";
}
export function attachmentMetadata(
  filename: unknown,
  mime: unknown,
  size: unknown,
  scope: ChatFileScope = "room",
) {
  if (
    typeof filename !== "string" ||
    !filename.trim() ||
    filename.length > 180 ||
    /[\x00-\x1f\x7f/\\]/.test(filename)
  )
    throw Error("Use a filename of 1–180 characters without path separators.");
  if (
    !CHAT_FILE_TYPES.includes(mime as ChatFileType) ||
    (scope !== "dm" && DM_ONLY_FILE_TYPES.includes(mime as ChatFileType)) ||
    !extensions[mime as ChatFileType].includes(filename.split(".").at(-1)?.toLowerCase() ?? "")
  )
    throw Error(attachmentTypesError(scope));
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 1 || size > CHAT_FILE_MAX_BYTES)
    throw Error("Files must be between 1 byte and 10 MB.");
  if (mime === "audio/wav" && size > VOICE_MAX_BYTES) throw Error("Voice clips must be at most 5 MB.");
  return { filename: filename.trim(), mime_type: mime as ChatFileType, byte_size: size };
}
/**
 * HTML is checked as plain text: valid UTF-8 (a BOM is fine), no NUL bytes and no binary
 * control characters. It does not have to contain an <html> tag.
 */
export function looksLikeTextFile(bytes: Uint8Array) {
  if (!bytes.length) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  // Allow tab, line feed, form feed and carriage return; anything else below 0x20, or DEL,
  // means this is not a text document (NUL included).
  for (const byte of bytes)
    if ((byte < 0x20 && ![9, 10, 12, 13].includes(byte)) || byte === 0x7f) return false;
  return true;
}
// A filename and browser MIME type are only hints. Check the actual bytes as well.
// This is file-type validation, never a substitute for the malware scanner.
export function attachmentSignature(bytes: Uint8Array, mime: ChatFileType) {
  const starts = (signature: number[]) => signature.every((byte, i) => bytes[i] === byte);
  if (mime === "audio/wav") {
    try {
      voiceDuration(bytes);
      return true;
    } catch {
      return false;
    }
  }
  if (mime === "text/html") return looksLikeTextFile(bytes);
  if (mime === "image/png") return starts([137, 80, 78, 71, 13, 10, 26, 10]);
  if (mime === "image/jpeg") return starts([255, 216, 255]);
  if (mime === "image/gif") return starts([71, 73, 70, 56, 55, 97]) || starts([71, 73, 70, 56, 57, 97]);
  return starts([37, 80, 68, 70, 45]);
}
