const NY_TZ = "America/New_York";

/**
 * #403 (Rob, Nov 9): the morning report finds its stocks from 6:45 AM Central and does a full
 * rebuild (scan, filters, ranking) every 15 minutes through 8:45 AM Central on trading days. The
 * Booker Stock Club posts a new #1 when the report's #1 changes inside the same window. Minutes
 * since midnight, Chicago time (DST handled by the Intl time zone; Vercel cron runs in UTC).
 */
export const MORNING_WINDOW_TZ = "America/Chicago";
export const MORNING_WINDOW_START_MIN = 6 * 60 + 45;
export const MORNING_WINDOW_END_MIN = 8 * 60 + 45;
export const MORNING_WINDOW_STEP_MIN = 15;
/** A run counts for its slot if it starts within this many minutes of it (cron can start late). */
const SLOT_GRACE_MIN = 5;

/** Chicago wall-clock minutes since midnight and weekday. */
export function chicagoClock(date: Date = new Date()): { minutes: number; weekday: string } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: MORNING_WINDOW_TZ, hourCycle: "h23", hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")), weekday: get("weekday") };
}

/** One of the rebuild runs: 6:45, 7:00 … 8:45 AM Central on a weekday. */
export function isMorningRebuildSlot(date: Date = new Date()): boolean {
  const { minutes, weekday } = chicagoClock(date);
  if (weekday === "Sat" || weekday === "Sun") return false;
  if (minutes < MORNING_WINDOW_START_MIN || minutes > MORNING_WINDOW_END_MIN + SLOT_GRACE_MIN - 1) return false;
  return (minutes - MORNING_WINDOW_START_MIN) % MORNING_WINDOW_STEP_MIN < SLOT_GRACE_MIN;
}

/**
 * The window in which a new #1 may still change the day's pick: from the first run until the run
 * after the last one starts (6:45 to 9:00 AM Central), so the 8:45 rebuild's save still counts.
 */
export function inMorningUpdateWindow(date: Date = new Date()): boolean {
  const { minutes } = chicagoClock(date);
  return minutes >= MORNING_WINDOW_START_MIN && minutes < MORNING_WINDOW_END_MIN + MORNING_WINDOW_STEP_MIN;
}

/** After the morning window (from 9:00 AM Central). */
export function afterMorningUpdateWindow(date: Date = new Date()): boolean {
  return chicagoClock(date).minutes >= MORNING_WINDOW_END_MIN + MORNING_WINDOW_STEP_MIN;
}

// 6:45 AM Central is 7:45 AM Eastern all year (both zones change clocks on the same dates).
export const MORNING_REPORT_HOUR_ET = 7;
export const MORNING_REPORT_MINUTE_ET = 45;
export const MORNING_REPORT_TIME_LABEL = "7:45 AM ET";

type EtDateParts = {
  year: number;
  month: number;
  day: number;
  weekday: string;
  hour: number;
  minute: number;
};

export type MorningReportAvailability = {
  scheduledAt: Date;
  scheduledReportDate: string;
  scheduledDateLabel: string;
  scheduledTimeLabel: string;
  isDue: boolean;
  remainingMs: number;
};

export type MorningReportWeekRange = {
  weekStart: string;
  weekEnd: string;
};

function etDateParts(date: Date): EtDateParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "0";
  return {
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    weekday: value("weekday"),
    hour: Number(value("hour")) % 24,
    minute: Number(value("minute")),
  };
}

function ymd(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function etWallTimeToDate(year: number, month: number, day: number, hour: number, minute: number): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  const rendered = etDateParts(new Date(utcGuess));
  const renderedAsUtc = Date.UTC(rendered.year, rendered.month - 1, rendered.day, rendered.hour, rendered.minute);
  return new Date(utcGuess - (renderedAsUtc - utcGuess));
}

function nextWeekdayDate(parts: EtDateParts): { year: number; month: number; day: number } {
  const isWeekend = parts.weekday === "Sat" || parts.weekday === "Sun";
  const base = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
  let offset = isWeekend ? 1 : 0;

  while (offset < 8) {
    const candidate = new Date(base.getTime() + offset * 86_400_000);
    const weekday = candidate.getUTCDay();
    if (weekday >= 1 && weekday <= 5) {
      return {
        year: candidate.getUTCFullYear(),
        month: candidate.getUTCMonth() + 1,
        day: candidate.getUTCDate(),
      };
    }
    offset += 1;
  }

  throw new Error("Unable to resolve the next morning report weekday");
}

export function etReportDate(date: Date = new Date()): string {
  const parts = etDateParts(date);
  return ymd(parts.year, parts.month, parts.day);
}

export function isEtWeekend(date: Date = new Date()): boolean {
  const weekday = etDateParts(date).weekday;
  return weekday === "Sat" || weekday === "Sun";
}

export function getEtReportWeekRange(date: Date = new Date()): MorningReportWeekRange {
  const parts = etDateParts(date);
  const current = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
  const daysSinceMonday = (current.getUTCDay() + 6) % 7;
  const monday = new Date(current.getTime() - daysSinceMonday * 86_400_000);
  const friday = new Date(monday.getTime() + 4 * 86_400_000);

  return {
    weekStart: ymd(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate()),
    weekEnd: ymd(friday.getUTCFullYear(), friday.getUTCMonth() + 1, friday.getUTCDate()),
  };
}

/** #403: the scheduled build now runs at every rebuild slot (6:45-8:45 AM Central), not once at 6:30 ET. */
export function isMorningBuildMinute(date: Date = new Date()): boolean {
  return isMorningRebuildSlot(date);
}

export function isMorningReportFresh(reportDate: string | null | undefined, now: Date = new Date()): boolean {
  return Boolean(reportDate && reportDate === etReportDate(now));
}

export function getMorningReportAvailability(now: Date = new Date()): MorningReportAvailability {
  const parts = etDateParts(now);
  const scheduledDate = nextWeekdayDate(parts);
  const scheduledAt = etWallTimeToDate(
    scheduledDate.year,
    scheduledDate.month,
    scheduledDate.day,
    MORNING_REPORT_HOUR_ET,
    MORNING_REPORT_MINUTE_ET,
  );
  const remainingMs = Math.max(0, scheduledAt.getTime() - now.getTime());
  const scheduledDateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: NY_TZ,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(scheduledAt).toUpperCase();

  return {
    scheduledAt,
    scheduledReportDate: ymd(scheduledDate.year, scheduledDate.month, scheduledDate.day),
    scheduledDateLabel,
    scheduledTimeLabel: MORNING_REPORT_TIME_LABEL,
    isDue: remainingMs === 0,
    remainingMs,
  };
}

export function formatMorningReportCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const clock = [hours, minutes, seconds].map((value) => value.toString().padStart(2, "0")).join(":");
  return days > 0 ? `${days}D ${clock}` : clock;
}
