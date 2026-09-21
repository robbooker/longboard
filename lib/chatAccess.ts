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
  if (access.longboard && access.admin) return CHAT_ROOMS.map(room => room.slug);
  const rooms: ChatRoom[] = [];
  if (access.longboard && access.boardroom) rooms.push("main");
  if (access.longboard || access.shortscout || access.shortscoutMember) rooms.push("social");
  if (access.shortscout) rooms.push("shortscout");
  if (access.longboard && access.boardroom) rooms.push("lb-announcements");
  if (access.shortscout) rooms.push("ss-announcements");
  if (access.longboard || access.shortscout || access.shortscoutMember) rooms.push("gainers");
  return rooms;
}

export function canAccessChatRoom(access: ChatEntitlements, room: ChatRoom): boolean {
  return allowedChatRooms(access).includes(room);
}

/** Expand an all-room search only to searchable rooms this member can read. */
export function allowedChatSearchRooms(access: ChatEntitlements): Array<"main" | "social"> {
  return allowedChatRooms(access).filter((room): room is "main" | "social" => room === "main" || room === "social");
}

export function canWriteChatRoom(access:ChatEntitlements,room:ChatRoom){return room !== "gainers" && canAccessChatRoom(access,room) && (!isAnnouncementRoom(room) || access.admin);}
