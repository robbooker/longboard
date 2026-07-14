import { addIsoDays, mondayForEtDate } from "./calculate";

export const MAX_LONGING_REPORT_DAYS = 31;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type LongingReportRange = {
  start: string;
  end: string;
  days: number;
};

export class LongingReportRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LongingReportRangeError";
  }
}

function isoDayNumber(iso: string): number {
  return Math.floor(Date.parse(`${iso}T12:00:00Z`) / 86_400_000);
}

function validDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  return new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}

export function resolveLongingReportRange(
  input: { start?: string | null; end?: string | null; week?: string | null },
  now = new Date(),
): LongingReportRange {
  const hasExplicitRange = Boolean(input.start || input.end);
  const fallbackStart = input.week ?? mondayForEtDate(now);
  const start = hasExplicitRange ? (input.start ?? input.end ?? fallbackStart) : fallbackStart;
  const end = hasExplicitRange ? (input.end ?? input.start ?? start) : addIsoDays(start, 4);

  if (!validDate(start) || !validDate(end)) {
    throw new LongingReportRangeError("Invalid report dates. Use YYYY-MM-DD.");
  }

  const days = isoDayNumber(end) - isoDayNumber(start) + 1;
  if (days < 1) {
    throw new LongingReportRangeError("The end date must be on or after the start date.");
  }
  if (days > MAX_LONGING_REPORT_DAYS) {
    throw new LongingReportRangeError(`Choose a date range of ${MAX_LONGING_REPORT_DAYS} days or fewer.`);
  }

  return { start, end, days };
}
