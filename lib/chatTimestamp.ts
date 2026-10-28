// Building a formatter is far slower than using one, and every row formats its time on render
// (a long DM has 1,000+ rows), so each format is built once. Same output as toLocale*String.
const formats = new Map<string, Intl.DateTimeFormat>();
const format = (locale: string | undefined, options: Intl.DateTimeFormatOptions) => {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = formats.get(key);
  if (!formatter) formats.set(key, (formatter = new Intl.DateTimeFormat(locale, options)));
  return formatter;
};

/**
 * Compact chat timestamp in the viewer's local timezone, the way people write times:
 * "14:05" today, "Yesterday 14:05", "Oct 12, 14:05" this year, "Oct 12, 2025" before that.
 */
export function chatTimestamp(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  const time = format("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((dayStart(now) - dayStart(date)) / 86_400_000);
  if (days === 0) return time;
  if (days === 1) return `Yesterday ${time}`;
  const day = format("en-US", { month: "short", day: "numeric" }).format(date);
  return date.getFullYear() === now.getFullYear() ? `${day}, ${time}` : `${day}, ${date.getFullYear()}`;
}

/** Full local date, year and timezone for hover and assistive context. */
export function chatTimestampTitle(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return format(undefined, { dateStyle: "full", timeStyle: "long" }).format(date);
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
    return format("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
  return format("en-US", { weekday: "short", month: "short", day: "numeric" }).format(date);
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export type Groupable = {
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

/** How long ago a thread's last reply came: "just now", "3 min ago", "2 hr ago", "3 days ago", then the date. */
export function threadReplyAge(iso: string, now = Date.now()): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? "day" : "days"} ago`;
  return format("en-US", { month: "short", day: "numeric" }).format(new Date(at));
}

