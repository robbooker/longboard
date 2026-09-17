import { isAnnouncementRoom, type ChatRoom } from "@/lib/publicChat";

/** Independent verified memberships. A ShortScout identity never implies LB access. */
export type ChatEntitlements = {
  longboard: boolean;
  shortscout: boolean;
  admin: boolean;
};

export function allowedChatRooms(access: ChatEntitlements): ChatRoom[] {
  const rooms: ChatRoom[] = [];
  if (access.longboard) rooms.push("main");
  if (access.longboard || access.shortscout) rooms.push("social");
  if (access.shortscout || (access.longboard && access.admin)) rooms.push("shortscout");
  if (access.longboard) rooms.push("lb-announcements");
  if (access.shortscout || (access.longboard && access.admin)) rooms.push("ss-announcements");
  return rooms;
}

export function canAccessChatRoom(access: ChatEntitlements, room: ChatRoom): boolean {
  return allowedChatRooms(access).includes(room);
}

/** Expand an all-room search only to searchable rooms this member can read. */
export function allowedChatSearchRooms(access: ChatEntitlements): Array<"main" | "social"> {
  return allowedChatRooms(access).filter((room): room is "main" | "social" => room === "main" || room === "social");
}

export function canWriteChatRoom(access:ChatEntitlements,room:ChatRoom){return canAccessChatRoom(access,room) && (!isAnnouncementRoom(room) || access.admin);}
