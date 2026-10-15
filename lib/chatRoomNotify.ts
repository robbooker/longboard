import type { ChatRoom } from "./publicChat";

/** ROOM-NOTIFY: each person's choice per room. No saved choice means "all". */
export const ROOM_NOTIFY_LEVELS = ["all", "mentions", "muted"] as const;
export type RoomNotifyLevel = (typeof ROOM_NOTIFY_LEVELS)[number];
export type RoomNotifyLevels = Partial<Record<ChatRoom, RoomNotifyLevel>>;

export const ROOM_NOTIFY_OPTIONS: ReadonlyArray<{ value: RoomNotifyLevel; label: string; hint: string }> = [
  { value: "all", label: "All messages", hint: "Badge for every new message" },
  { value: "mentions", label: "Mentions only", hint: "Only @mentions and replies to you" },
  { value: "muted", label: "Muted", hint: "No alerts, no badge" },
];

export function parseRoomNotifyLevel(value: unknown): RoomNotifyLevel | null {
  return typeof value === "string" && (ROOM_NOTIFY_LEVELS as readonly string[]).includes(value)
    ? (value as RoomNotifyLevel)
    : null;
}

/** The room's level; anything unknown (or an older server without levels) reads as "all". */
export function roomNotifyLevel(levels: RoomNotifyLevels | undefined, room: ChatRoom): RoomNotifyLevel {
  return parseRoomNotifyLevel(levels?.[room]) ?? "all";
}

/**
 * The setting is offered only when the bell reports levels (the ROOM-NOTIFY migration is in);
 * before that every room behaves as "all" and nothing is shown.
 */
export function roomNotifyAvailable(data: { roomLevels?: unknown }): boolean {
  return !!data.roomLevels && typeof data.roomLevels === "object" && !Array.isArray(data.roomLevels);
}

/**
 * Sidebar / pin / switcher badge per room: every unread message on "all", only unread
 * mentions and replies on "mentions", nothing on "muted" (the row is dimmed instead, like Slack).
 * Returns the server's map unchanged when no room has a non-default level.
 */
export function roomBadgeCounts(data: {
  roomMessageCounts: Partial<Record<ChatRoom, number>>;
  roomCounts: Partial<Record<ChatRoom, number>>;
  roomLevels?: RoomNotifyLevels;
}): Partial<Record<ChatRoom, number>> {
  const levels = data.roomLevels;
  if (!levels || !Object.values(levels).some((level) => level === "mentions" || level === "muted"))
    return data.roomMessageCounts;
  const result: Partial<Record<ChatRoom, number>> = { ...data.roomMessageCounts };
  for (const room of Object.keys(levels) as ChatRoom[]) {
    const level = roomNotifyLevel(levels, room);
    if (level === "muted") result[room] = 0;
    else if (level === "mentions") result[room] = data.roomCounts?.[room] ?? 0;
  }
  return result;
}
