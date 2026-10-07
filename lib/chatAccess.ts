import { CHAT_ROOMS, isAnnouncementRoom, type ChatRoom } from "@/lib/publicChat";

/** Independent verified memberships. A ShortScout identity never implies LB access. */
export type ChatEntitlements = {
  longboard: boolean;
  boardroom?: boolean; // Exact server-verified cohort 1 or 2 tag; absent fails closed.
  shortscout: boolean; // Exact verified mastermind entitlement for SS rooms.
  shortscoutMember?: boolean; // Other verified paid tiers retain SOCIAL.
  admin: boolean;
};

export function allowedChatRooms(access: ChatEntitlements): ChatRoom[] {
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
  return rooms;
}

export function canAccessChatRoom(access: ChatEntitlements, room: ChatRoom): boolean {
  return allowedChatRooms(access).includes(room);
}

/** Search includes only the three conversation rooms this member can read. */
export function allowedChatSearchRooms(access: ChatEntitlements): Array<"main" | "social" | "shortscout"> {
  return allowedChatRooms(access).filter(
    (room): room is "main" | "social" | "shortscout" =>
      room === "main" || room === "social" || room === "shortscout",
  );
}

export function canWriteChatRoom(access: ChatEntitlements, room: ChatRoom) {
  return room !== "gainers" && canAccessChatRoom(access, room) && (!isAnnouncementRoom(room) || access.admin);
}
