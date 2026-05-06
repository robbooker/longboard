// Shared between CommandCenterV2 (the live tape on /command2) and
// Command2NavLive (the client-side wrapper that ticks the clock for
// surfaces that just want the nav, like essay detail pages). Single
// source of truth so a session-boundary fix lands in both places.

export type LiveTime = {
  clock: string;
  session: string;
  dateStr: string;
  weekdayLong: string;
};

// Static fallback strings used for SSR + first client paint pre-hydration.
// Match the original mockup so the page degrades gracefully if JS is off.
export const FALLBACK_LIVE_TIME: LiveTime = {
  clock: "9:42 ET",
  session: "MARKET OPEN",
  dateStr: "FRI · MAY 1 · 2026",
  weekdayLong: "Friday",
};

// NOTE: NYSE holiday handling is intentionally out of scope here — a future
// pass can layer in a holiday calendar lookup. For now weekends + standard
// 4:00 / 9:30 / 16:00 / 20:00 ET equity-session boundaries are enough.
export function computeLiveTime(): LiveTime {
  const now = new Date();

  const timeParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hourRaw = timeParts.find((p) => p.type === "hour")?.value ?? "0";
  // en-US with hour12:false renders midnight as "24"; normalize to 0..23.
  const hour = Number(hourRaw) % 24;
  const minute = timeParts.find((p) => p.type === "minute")?.value ?? "00";
  const clock = `${hour}:${minute} ET`;

  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).formatToParts(now);
  const weekday = dateParts.find((p) => p.type === "weekday")?.value ?? "";
  const month = dateParts.find((p) => p.type === "month")?.value ?? "";
  const day = dateParts.find((p) => p.type === "day")?.value ?? "";
  const year = dateParts.find((p) => p.type === "year")?.value ?? "";
  const dateStr = `${weekday.toUpperCase()} · ${month.toUpperCase()} ${day} · ${year}`;

  const weekdayLong = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
  }).format(now);

  const minutesOfDay = hour * 60 + Number(minute);
  const isWeekend = weekday === "Sat" || weekday === "Sun";
  let session: string;
  if (isWeekend) session = "CLOSED";
  else if (minutesOfDay >= 4 * 60 && minutesOfDay < 9 * 60 + 30) session = "PRE-MARKET";
  else if (minutesOfDay >= 9 * 60 + 30 && minutesOfDay < 16 * 60) session = "MARKET OPEN";
  else if (minutesOfDay >= 16 * 60 && minutesOfDay < 20 * 60) session = "AFTER-HOURS";
  else session = "CLOSED";

  return { clock, session, dateStr, weekdayLong };
}
