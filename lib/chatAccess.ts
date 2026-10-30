import { CHAT_ROOMS, isAnnouncementRoom, type ChatRoom } from "@/lib/publicChat";

/** Independent verified memberships. A ShortScout identity never implies LB access. */
export type ChatEntitlements = {
  longboard: boolean;
  boardroom?: boolean; // Exact server-verified cohort 1 or 2 tag; absent fails closed.
  shortscout: boolean; // Exact verified mastermind entitlement for SS rooms.
  shortscoutMember?: boolean; // Other verified paid tiers retain SOCIAL.
  admin: boolean;
  /**
   * #330: a bot account (chat_bot_accounts). When present these are its only rooms, whatever else
   * is set, and it has no direct messages. Only the API-token sign-in ever sets it.
   */
  botRooms?: string[];
};

export function allowedChatRooms(access: ChatEntitlements): ChatRoom[] {
  if (access.botRooms) {
    const rooms = access.botRooms;
    return CHAT_ROOMS.map((room) => room.slug).filter((room) => rooms.includes(room));
  }
  if (access.longboard && access.admin) return CHAT_ROOMS.map((room) => room.slug);
  const rooms: ChatRoom[] = [];
  if (access.longboard && access.boardroom) rooms.push("main");
  if (access.longboard || access.shortscout || access.shortscoutMember) rooms.push("social");
  if (access.shortscout) rooms.push("shortscout");
  if (access.longboard && access.boardroom) rooms.push("lb-announcements");
  if (access.shortscout) rooms.push("ss-announcements");
  if (access.longboard || access.shortscout || access.shortscoutMember) rooms.push("gainers");
  if (access.longboard && access.boardroom) rooms.push("lb-recordings");
  if (access.shortscout) rooms.push("ss-recordings");
  // #302: every chat member is in What's New, with no joining step.
  if (access.longboard || access.shortscout || access.shortscoutMember) rooms.push("whats-new");
  // #322: Developers is open to every chat member too, like Social: anyone posts, no joining step.
  if (access.longboard || access.shortscout || access.shortscoutMember) rooms.push("developers");
  return rooms;
}

export function canAccessChatRoom(access: ChatEntitlements, room: ChatRoom): boolean {
  return allowedChatRooms(access).includes(room);
}

/** #330: bot accounts can't send, receive or read direct messages. */
export function canUseDirectMessages(access: ChatEntitlements) {
  return !access?.botRooms;
}

export type ChatSearchRoom = "main" | "social" | "shortscout" | "developers";

/** Search includes only the conversation rooms this member can read (Developers added in #322). */
export function allowedChatSearchRooms(access: ChatEntitlements): ChatSearchRoom[] {
  return allowedChatRooms(access).filter(
    (room): room is ChatSearchRoom =>
      room === "main" || room === "social" || room === "shortscout" || room === "developers",
  );
}

export function canWriteChatRoom(access: ChatEntitlements, room: ChatRoom) {
  return room !== "gainers" && canAccessChatRoom(access, room) && (!isAnnouncementRoom(room) || access.admin);
}
