// Fast America/New_York wall-clock lookups for bar timestamps (unix seconds).
//
// The scanners used to build an Intl.DateTimeFormat (or call formatToParts) for every bar,
// which was most of the RVOL scan's CPU. New York's UTC offset is always a whole number of
// hours and only changes on a UTC hour boundary (DST switches at 06:00/07:00 UTC), so the
// ET date and hour are the same for every second of a UTC hour and the ET minute equals the
// UTC minute. We ask Intl once per UTC hour and remember the answer. The results are
// identical to formatting each timestamp with Intl (see lib/time/__tests__/etClock.test.ts).

export type EtClockParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

type EtHour = { year: number; month: number; day: number; hour: number; dateIso: string };

const ET_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const MAX_CACHED_HOURS = 50_000;
const hours = new Map<number, EtHour>();

function lookupHour(hourStartSeconds: number): EtHour {
  const parts = ET_PARTS.formatToParts(new Date(hourStartSeconds * 1000));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const year = get("year");
  const month = get("month");
  const day = get("day");
  return {
    year,
    month,
    day,
    hour: get("hour"),
    dateIso: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

function etHour(unixSeconds: number): EtHour {
  const bucket = Math.floor(unixSeconds / 3600);
  let entry = hours.get(bucket);
  if (!entry) {
    if (hours.size >= MAX_CACHED_HOURS) hours.clear();
    entry = lookupHour(bucket * 3600);
    hours.set(bucket, entry);
  }
  return entry;
}

function minuteOfHour(unixSeconds: number): number {
  return Math.floor((unixSeconds - Math.floor(unixSeconds / 3600) * 3600) / 60);
}

function assertFinite(unixSeconds: number) {
  // Same failure as Intl on an invalid Date.
  if (!Number.isFinite(unixSeconds)) ET_PARTS.format(new Date(NaN));
}

export function etClockParts(unixSeconds: number): EtClockParts {
  assertFinite(unixSeconds);
  const h = etHour(unixSeconds);
  return { year: h.year, month: h.month, day: h.day, hour: h.hour, minute: minuteOfHour(unixSeconds) };
}

/** Minutes since ET midnight (0–1439). */
export function etMinutesOfDay(unixSeconds: number): number {
  assertFinite(unixSeconds);
  return etHour(unixSeconds).hour * 60 + minuteOfHour(unixSeconds);
}

/** ET calendar date as YYYY-MM-DD. */
export function etDateIsoFromUnixSeconds(unixSeconds: number): string {
  assertFinite(unixSeconds);
  return etHour(unixSeconds).dateIso;
}
