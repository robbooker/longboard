/** Device-specific disclosure levels. Unknown/legacy settings always stay private. */
export type ChatPushPreview = "off" | "sender" | "message";
export function isChatPushPreview(value: unknown): value is ChatPushPreview {
  return value === "off" || value === "sender" || value === "message";
}
// Notifications are plain text. Strip hidden controls and formatting, never fetch media.
function cleanPushText(value: string, keepLines: boolean): string {
  let text = value
    .slice(0, 4000)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, "");
  if (keepLines) text = text.replace(/\r\n?|[\u2028\u2029]/g, "\n");
  text = text
    .replace(keepLines ? /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g : /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, " ")
    .replace(/[*_`~]/g, "")
    .replace(/[\ud800-\udfff]/gu, "");
  if (!keepLines) return text.replace(/\s+/g, " ").trim();
  // Expanded notifications show line breaks: keep them, with at most one blank line in a row.
  return text
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
export function pushPreviewText(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  const characters = Array.from(cleanPushText(value, false));
  return characters.length > limit
    ? characters.slice(0, Math.max(0, limit - 1)).join("") + "…"
    : characters.join("");
}
/** #465: the message body shows whole, cut at about 1,000 characters. */
export const PUSH_BODY_MAX_CHARACTERS = 1000;
/** Web push payloads must stay under ~4 KB after encryption; the whole JSON payload is kept under
 * PUSH_PAYLOAD_MAX_BYTES, and the body alone (as JSON-escaped UTF-8) under PUSH_BODY_MAX_BYTES. */
export const PUSH_PAYLOAD_MAX_BYTES = 3000;
export const PUSH_BODY_MAX_BYTES = 2400;
const encoder = new TextEncoder();
/** UTF-8 bytes a string takes inside a JSON payload, without its quotes. */
function jsonBytes(text: string): number {
  return encoder.encode(JSON.stringify(text)).length - 2;
}
function graphemes(text: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl)
    return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), s => s.segment);
  return Array.from(text);
}
/**
 * Cuts to at most `limit` code points and `maxBytes` JSON bytes (ellipsis included), on a whole
 * grapheme, and at a word break when one is in the last eighth of the kept text.
 */
export function fitPushText(text: string, limit: number, maxBytes: number): string {
  if (Array.from(text).length <= limit && jsonBytes(text) <= maxBytes) return text;
  const ellipsisBytes = jsonBytes("…");
  const kept: string[] = [];
  let points = 0,
    bytes = 0;
  for (const g of graphemes(text)) {
    const p = Array.from(g).length,
      b = jsonBytes(g);
    if (points + p > limit - 1 || bytes + b > maxBytes - ellipsisBytes) break;
    kept.push(g);
    points += p;
    bytes += b;
  }
  let cut = kept.join("");
  const space = cut.search(/\s\S*$/);
  if (space > 0 && space >= cut.length - Math.ceil(cut.length / 8)) cut = cut.slice(0, space);
  return cut.replace(/\s+$/u, "") + "…";
}
/** A message body for "message" previews: line breaks kept, cut by characters and bytes. */
export function pushMessageText(value: unknown, limit = PUSH_BODY_MAX_CHARACTERS, maxBytes = PUSH_BODY_MAX_BYTES): string {
  if (typeof value !== "string") return "";
  return fitPushText(cleanPushText(value, true), limit, maxBytes);
}
/** Final guard on the whole payload: trims the body further if title, url and tag push it over. */
export function fitPushPayload<T extends { body: string }>(payload: T, maxBytes = PUSH_PAYLOAD_MAX_BYTES): T {
  const over = encoder.encode(JSON.stringify(payload)).length - maxBytes;
  if (over <= 0) return payload;
  return { ...payload, body: fitPushText(payload.body, PUSH_BODY_MAX_CHARACTERS, Math.max(0, jsonBytes(payload.body) - over)) };
}
type ChatPushPreviewInput = {
  preview?: unknown;
  sender?: unknown;
  body?: unknown;
  kind?: unknown;
  room?: unknown;
  category?: unknown;
  hasAttachments?: unknown;
};
const PRIVATE_NOTIFICATION = { title: "Rob Booker Chat", body: "You have a new chat notification." };
/** Only existing push categories get contextual labels; unrecognized metadata stays generic. */
function notificationContext(input: ChatPushPreviewInput): string {
  if (input.kind === "dm") return "DM";
  if (input.kind !== "room") return "Chat";
  const room =
    input.room === "main"
      ? "LB"
      : input.room === "social"
        ? "Social"
        : input.room === "shortscout"
          ? "SS"
          : input.room === "developers"
            ? "Developers"
            : input.room === "lb-review"
              ? "LB Review"
            : input.room === "runner-watch"
              ? "Runner Watch"
            : input.room === "ai-insights"
              ? "AI Insights"
            : input.room === "webinars"
              ? "Webinars"
            : input.room === "admins"
              ? "Admins"
              : null;
  const category = input.category === "reply" ? "reply" : input.category === "mention" ? "mention" : null;
  return room && category ? `${room} ${category}` : "Chat";
}
/**
 * GAINERS-PUSH: Gainers posts are public market alerts, so they show whatever the preview setting.
 * "🚨 BRZE (+52.60%) 🕒 Pre-Market\n…" becomes "BRZE +52.60% · Pre-Market".
 */
export function gainersPushText(value: unknown): string {
  if (typeof value !== "string") return "New Gainers alert.";
  const line = value.slice(0, 600).split("\n")[0].replace(/\p{Extended_Pictographic}|\ufe0f/gu, " ");
  const alert = /^\s*\$?([A-Z][A-Z0-9.]{0,9})\s*\(([+-]?\d[\d.,]*%)\)\s*(.*)$/.exec(line);
  if (!alert) return pushPreviewText(line, 40) || "New Gainers alert.";
  const session = pushPreviewText(alert[3], 20);
  const move = alert[2].startsWith("-") || alert[2].startsWith("+") ? alert[2] : `+${alert[2]}`;
  return pushPreviewText(`${alert[1]} ${move}${session ? ` · ${session}` : ""}`, 40);
}
export function chatPushNotification(input: ChatPushPreviewInput): { title: string; body: string } {
  if (input.kind === "gainers") return { title: "Gainers", body: gainersPushText(input.body) };
  if (input.preview !== "sender" && input.preview !== "message") return { ...PRIVATE_NOTIFICATION };
  const sender = pushPreviewText(input.sender, 40) || "Someone";
  const title = `${notificationContext(input)} - ${sender}`;
  const body =
    input.preview === "sender"
      ? PRIVATE_NOTIFICATION.body
      : pushMessageText(input.body) ||
        (input.hasAttachments === true ? "Sent an attachment." : "Sent a message.");
  return { title, body };
}
