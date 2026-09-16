/** Compact chat timestamp in the viewer's local timezone. */
export function chatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  const day = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `[${day} | ${time}]`;
}

/** Full local date, year and timezone for hover and assistive context. */
export function chatTimestampTitle(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleString(undefined, { dateStyle: "full", timeStyle: "long" });
}
