/**
 * Compact chat timestamp in the viewer's local timezone, the way people write times:
 * "14:05" today, "Yesterday 14:05", "Oct 12, 14:05" this year, "Oct 12, 2025" before that.
 */
export function chatTimestamp(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((dayStart(now) - dayStart(date)) / 86_400_000);
  if (days === 0) return time;
  if (days === 1) return `Yesterday ${time}`;
  const day = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return date.getFullYear() === now.getFullYear() ? `${day}, ${time}` : `${day}, ${date.getFullYear()}`;
}

/** Full local date, year and timezone for hover and assistive context. */
export function chatTimestampTitle(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleString(undefined, { dateStyle: "full", timeStyle: "long" });
}

/** Day divider label in the viewer's timezone: "Today", "Yesterday", "Mon, Oct 12", "Oct 12, 2025". */
export function chatDayLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((dayStart(now) - dayStart(date)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (date.getFullYear() !== now.getFullYear())
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

type Groupable = {
  created_at: string;
  member_id?: string | null;
  guest_id?: string | null;
  bot_slug?: string | null;
  author_label?: string;
};
/**
 * Where a message sits in the list: a day divider before it when the day changes, and whether it
 * continues the previous person's group (same author, same day, within 5 minutes).
 */
export function chatMessagePlacement(
  previous: Groupable | undefined,
  message: Groupable,
  options: { breakGroup?: boolean } = {},
): { day: string | null; continued: boolean } {
  const at = new Date(message.created_at);
  const before = previous ? new Date(previous.created_at) : null;
  const newDay = !before || Number.isNaN(before.getTime()) || !sameDay(before, at);
  const author = (m: Groupable) => `${m.bot_slug ?? ""}:${m.member_id ?? m.guest_id ?? m.author_label ?? ""}`;
  const continued =
    !!previous &&
    !newDay &&
    !options.breakGroup &&
    author(previous) === author(message) &&
    at.getTime() - before!.getTime() >= 0 &&
    at.getTime() - before!.getTime() <= 5 * 60_000;
  return { day: newDay ? chatDayLabel(message.created_at) : null, continued };
}
