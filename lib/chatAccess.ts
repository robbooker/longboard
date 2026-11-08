import { CHAT_ROOMS, isAnnouncementRoom, roomHasSummaries, type ChatRoom } from "@/lib/publicChat";
import { clubRoomAccess } from "@/lib/stockClub";

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
  /**
   * #384: active entitlement keys from purchases or admin grants (member_entitlements), e.g.
   * "gainers", "reader", "club-room". Present only when there is at least one. Check it with
   * accessHasEntitlement (lib/memberAccess.ts); never set it from anything a browser sent.
   */
  member?: string[];
};

/** #384: an active entitlement on this access (bots never have any). */
function entitled(access: ChatEntitlements, key: string) {
  return !access.botRooms && Array.isArray(access.member) && access.member.includes(key);
}

export function allowedChatRooms(access: ChatEntitlements): ChatRoom[] {
  if (access.botRooms) {
    const rooms = access.botRooms;
    return CHAT_ROOMS.map((room) => room.slug).filter((room) => room !== "admins" && rooms.includes(room));
  }
  // #332: the admins room is reached only through this line; no other tier below ever lists it.
  if (access.longboard && access.admin) return CHAT_ROOMS.map((room) => room.slug);
  const rooms: ChatRoom[] = [];
  if (access.longboard && access.boardroom) rooms.push("main");
  if (access.longboard || access.shortscout || access.shortscoutMember) rooms.push("social");
  if (access.shortscout) rooms.push("shortscout");
  if (access.longboard && access.boardroom) rooms.push("lb-announcements");
  if (access.shortscout) rooms.push("ss-announcements");
  // #384: Booker Stock Club members (the 'gainers' entitlement) have Gainers too, which also opens
  // the Gainers Table and the News Feed (both check this room).
  if (access.longboard || access.shortscout || access.shortscoutMember || entitled(access, "gainers"))
    rooms.push("gainers");
  if (access.longboard && access.boardroom) rooms.push("lb-recordings");
  if (access.shortscout) rooms.push("ss-recordings");
  // #302: every chat member is in What's New, with no joining step.
  if (access.longboard || access.shortscout || access.shortscoutMember) rooms.push("whats-new");
  // #322: Developers is open to every chat member too, like Social: anyone posts, no joining step.
  if (access.longboard || access.shortscout || access.shortscoutMember) rooms.push("developers");
  // #340: LB Review is open to every chat member too, for now.
  if (access.longboard || access.shortscout || access.shortscoutMember) rooms.push("lb-review");
  // #386: Booker Stock Club, read-only. Its rule lives in one place (clubRoomAccess).
  if (clubRoomAccess(access)) rooms.push("club");
  return rooms;
}

export function canAccessChatRoom(access: ChatEntitlements, room: ChatRoom): boolean {
  return allowedChatRooms(access).includes(room);
}

/** #334: rooms whose summaries this member may see in their inbox. */
export function allowedSummaryRooms(access: ChatEntitlements): ChatRoom[] {
  return allowedChatRooms(access).filter(roomHasSummaries);
}

/** #330: bot accounts can't send, receive or read direct messages. */
export function canUseDirectMessages(access: ChatEntitlements) {
  return !access?.botRooms;
}

export type ChatSearchRoom = "main" | "social" | "shortscout" | "developers" | "lb-review" | "admins";

/** Search includes only the conversation rooms this member can read (Developers added in #322). */
export function allowedChatSearchRooms(access: ChatEntitlements): ChatSearchRoom[] {
  return allowedChatRooms(access).filter(
    (room): room is ChatSearchRoom =>
      room === "main" || room === "social" || room === "shortscout" || room === "developers" || room === "lb-review" || room === "admins",
  );
}

export function canWriteChatRoom(access: ChatEntitlements, room: ChatRoom) {
  return room !== "gainers" && room !== "club" && canAccessChatRoom(access, room) && (!isAnnouncementRoom(room) || access.admin);
}
