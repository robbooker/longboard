/**
 * Returns the most recent trading day as a YYYY-MM-DD string in ET.
 *
 * Logic:
 *   - Take the ET calendar date of `now`.
 *   - If Saturday → return Friday (date - 1).
 *   - If Sunday   → return Friday (date - 2).
 *   - Otherwise (Mon-Fri) → return today's ET date.
 *
 * Known limitation: this does NOT account for US market holidays
 * (Thanksgiving, Christmas, Good Friday, etc.). On those days callers
 * may get a date with no Polygon data. Revisit when a holiday-calendar
 * source is wired up.
 */
export function mostRecentTradingDay(now: Date = new Date()): string {
  const etParts = etDateParts(now);
  const utcMidnight = Date.UTC(etParts.year, etParts.month - 1, etParts.day);
  const dow = new Date(utcMidnight).getUTCDay(); // 0=Sun, 6=Sat
  let shiftDays = 0;
  if (dow === 6) shiftDays = -1;
  else if (dow === 0) shiftDays = -2;
  const shifted = new Date(utcMidnight + shiftDays * 86400000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function etDateParts(d: Date): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}
