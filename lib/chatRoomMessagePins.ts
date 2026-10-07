export type RoomMessagePin = {
  messageId: string;
  replyToId: string | null;
  memberId: string | null;
  authorLabel: string;
  preview: string;
  pinnedAt: string;
  createdAt: string;
};
export type RoomMessagePins = { pins: RoomMessagePin[]; canManagePins: boolean };
export const ROOM_MESSAGE_PIN_LIMIT = 10;
export const ROOM_MESSAGE_PIN_BYTES = 16384;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Bound the complete list, including multibyte/escaped text, without dropping IDs. */
export function projectRoomMessagePins(value: unknown, admin: boolean): RoomMessagePins {
  const raw = value as Partial<RoomMessagePins> | null;
  const pins: RoomMessagePin[] = [];
  for (const item of Array.isArray(raw?.pins) ? raw.pins : []) {
    if (
      !item ||
      !uuid.test(item.messageId) ||
      pins.some((pin) => pin.messageId === item.messageId) ||
      typeof item.preview !== "string" ||
      typeof item.authorLabel !== "string" ||
      typeof item.pinnedAt !== "string" ||
      typeof item.createdAt !== "string"
    )
      continue;
    pins.push({
      messageId: item.messageId,
      replyToId: typeof item.replyToId === "string" && uuid.test(item.replyToId) ? item.replyToId : null,
      memberId: typeof item.memberId === "string" && uuid.test(item.memberId) ? item.memberId : null,
      authorLabel: item.authorLabel.slice(0, 100),
      preview: item.preview.slice(0, 240),
      pinnedAt: item.pinnedAt.slice(0, 40),
      createdAt: item.createdAt.slice(0, 40),
    });
    if (pins.length === ROOM_MESSAGE_PIN_LIMIT) break;
  }
  const result = { pins, canManagePins: admin && raw?.canManagePins === true };
  while (new TextEncoder().encode(JSON.stringify(result)).byteLength > ROOM_MESSAGE_PIN_BYTES) {
    for (const pin of pins) {
      pin.preview = pin.preview.slice(0, Math.max(0, pin.preview.length - 20));
      pin.authorLabel = pin.authorLabel.slice(0, 50);
    }
  }
  return result;
}
