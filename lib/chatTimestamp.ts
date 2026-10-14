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
