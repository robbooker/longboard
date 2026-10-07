/** Device-specific disclosure levels. Unknown/legacy settings always stay private. */
export type ChatPushPreview = "off" | "sender" | "message";
export function isChatPushPreview(value: unknown): value is ChatPushPreview {
  return value === "off" || value === "sender" || value === "message";
}
export function pushPreviewText(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  // Notifications are plain text. Strip hidden controls and formatting, never fetch media.
  const text = value
    .slice(0, 2000)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, " ")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const characters = Array.from(text.replace(/[\ud800-\udfff]/gu, ""));
  return characters.length > limit
    ? characters.slice(0, Math.max(0, limit - 1)).join("") + "…"
    : characters.join("");
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
          : null;
  const category = input.category === "reply" ? "reply" : input.category === "mention" ? "mention" : null;
  return room && category ? `${room} ${category}` : "Chat";
}
export function chatPushNotification(input: ChatPushPreviewInput): { title: string; body: string } {
  if (input.preview !== "sender" && input.preview !== "message") return { ...PRIVATE_NOTIFICATION };
  const sender = pushPreviewText(input.sender, 40) || "Someone";
  const title = `${notificationContext(input)} - ${sender}`;
  const body =
    input.preview === "sender"
      ? PRIVATE_NOTIFICATION.body
      : pushPreviewText(input.body, 40) ||
        (input.hasAttachments === true ? "Sent an attachment." : "Sent a message.");
  return { title, body };
}
