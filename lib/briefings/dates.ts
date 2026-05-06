// Briefing date is anchored to US/Eastern, not server-local or UTC. A user
// clicking at 11:30 PM ET on May 6 must still get May 6's briefing — the
// usual `new Date().toISOString().slice(0, 10)` shortcut would roll over to
// May 7 because the server runs in UTC.

export function todayEt(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";

  return `${get("year")}-${get("month")}-${get("day")}`;
}
