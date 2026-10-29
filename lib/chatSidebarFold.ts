import { isAnnouncementRoom, type ChatRoom } from "./publicChat";

/**
 * D-324: each group in the chat's left column can be folded to just its heading. The choice is
 * each person's own and lives on this device only (localStorage), keyed by their chat member id.
 * Nothing folded is the default, so a new device or a cleared browser shows every group open.
 */
export const SIDEBAR_FOLD_GROUPS = [
  "pinned",
  "rooms",
  "announcements",
  "recordings",
  "pages",
  "dms",
] as const;
export type SidebarFoldGroup = (typeof SIDEBAR_FOLD_GROUPS)[number];

export const SIDEBAR_FOLD_PREFIX = "longboard-chat-sidebar-folds:v1:";

/** The storage key for one person's folds ("guest" before anyone is signed in). */
export function sidebarFoldKey(memberId: string | null | undefined) {
  return SIDEBAR_FOLD_PREFIX + (memberId || "guest");
}

export function isSidebarFoldGroup(value: unknown): value is SidebarFoldGroup {
  return typeof value === "string" && (SIDEBAR_FOLD_GROUPS as readonly string[]).includes(value);
}

/** The folded groups in a stored value. Anything unreadable or unknown is dropped (nothing folded). */
export function parseSidebarFolds(raw: string | null | undefined): SidebarFoldGroup[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return SIDEBAR_FOLD_GROUPS.filter((group) => value.includes(group));
}

/** The stored value with `group` folded or unfolded; groups keep a fixed order, so equal states store equal text. */
export function toggleSidebarFold(raw: string | null | undefined, group: SidebarFoldGroup, folded: boolean) {
  const current = new Set(parseSidebarFolds(raw));
  if (folded) current.add(group);
  else current.delete(group);
  return JSON.stringify(SIDEBAR_FOLD_GROUPS.filter((name) => current.has(name)));
}

/**
 * What a folded heading shows: the unread total across the rooms in its group, and whether any of
 * them holds an unread @mention or reply to you. `badges` is the sidebar's per-room badge
 * (roomBadgeCounts: muted rooms are already 0, mentions-only rooms count only mentions) and
 * `mentions` the bell's unread mention count per room (muted rooms are already left out).
 *
 * A mention counts only while its room still has unread messages: reading a room does not clear
 * the bell's entry, so without this the mark would stay after the room was read. Posts in the
 * Announcements, Recordings and What's New rooms reach the bell for everyone; they are not a
 * personal mention, so they never show the mark (their unread count still adds up).
 * Rooms the person can't open are skipped, as their rows show a lock and no count.
 */
export function foldedRoomTotals(
  rooms: readonly ChatRoom[],
  badges: Partial<Record<ChatRoom, number>> | undefined,
  mentions: Partial<Record<ChatRoom, number>> | undefined,
  allowed?: readonly ChatRoom[],
): { unread: number; mention: boolean } {
  let unread = 0,
    mention = false;
  for (const room of rooms) {
    if (allowed && !allowed.includes(room)) continue;
    unread += countOf(badges?.[room]);
    if (roomHasMention(room, badges, mentions)) mention = true;
  }
  return { unread, mention };
}

/** An unread personal @mention or reply in a room that still has unread messages (see above). */
export function roomHasMention(
  room: ChatRoom,
  badges: Partial<Record<ChatRoom, number>> | undefined,
  mentions: Partial<Record<ChatRoom, number>> | undefined,
) {
  return !isAnnouncementRoom(room) && countOf(mentions?.[room]) > 0 && countOf(badges?.[room]) > 0;
}

/** A safe count: anything that isn't a whole, non-negative number reads as 0. */
export function countOf(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/** The total of several unread counts (the DM list, the pinned rows). */
export function sumCounts(values: Iterable<unknown>) {
  let total = 0;
  for (const value of values) total += countOf(value);
  return total;
}
