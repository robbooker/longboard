/**
 * D-212 (UNREAD-COUNTERS): the bell's numbers from chat_activity_counters instead of
 * chat_activity_inbox (migration 20261024120000_chat_activity_counters.sql).
 *
 * `CHAT_BELL_COUNTERS` (server):
 * - `off` (default, also when unset): every bell read runs chat_activity_inbox, as before.
 * - `compare`: still chat_activity_inbox for everyone, and each read also reads the counters
 *   and logs `[chat-bell-counters]` when any number differs (and a 2% sample of matches), so the
 *   two can be compared on live data before anything relies on the counters.
 * - `admins` / `all`: a read that needs only the numbers (`lists=0`, the closed bell) reads the
 *   counters; a read with the lists (the open bell, older windows, API tokens) still runs
 *   chat_activity_inbox.
 * Before the migration is applied the counters function is missing: every read quietly uses
 * chat_activity_inbox (checked again a minute later).
 */
export type ChatBellCountersRollout = "off" | "compare" | "admins" | "all";
export function chatBellCountersRollout(value: string | undefined): ChatBellCountersRollout {
  return value === "compare" || value === "admins" || value === "all" ? value : "off";
}

/** The keys chat_activity_counts returns; the same names and values as chat_activity_inbox. */
export const CHAT_BELL_COUNT_KEYS = [
  "roomLevels",
  "replyNotifications",
  "mentionCount",
  "mentionThrough",
  "roomCounts",
  "roomThrough",
  "pinnedDmUnread",
  "dmCount",
  "dmThrough",
  "reactionCount",
  "reactionThrough",
] as const;

const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const ka = Object.keys(a as object),
    kb = Object.keys(b as object);
  return (
    ka.length === kb.length &&
    ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  );
};

/** The count keys whose values differ between an inbox result and a counters result. */
export function chatBellCountDifferences(
  inbox: Record<string, unknown> | null | undefined,
  counts: Record<string, unknown> | null | undefined,
): string[] {
  return CHAT_BELL_COUNT_KEYS.filter((key) => !same(inbox?.[key], counts?.[key]));
}

/** A counters result made into a full bell snapshot: the numbers, and no lists (`lists: false`). */
export function chatBellCountsOnly(counts: Record<string, unknown>) {
  return {
    ...Object.fromEntries(CHAT_BELL_COUNT_KEYS.filter((key) => key in counts).map((key) => [key, counts[key]])),
    mentions: [],
    dms: [],
    reactions: [],
    lists: false as const,
  };
}
