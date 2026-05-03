import { nyClockToUtcMs } from "@/lib/polygon/client";

/**
 * Unix-seconds boundaries of the four ET trading-session zones for a
 * given calendar date. Used by the chart's session-shading overlay to
 * draw premarket / regular / after-hours bands.
 *
 *   pmStart  — 04:00 ET  (premarket open)
 *   rthStart — 09:30 ET  (regular session open)
 *   rthEnd   — 16:00 ET  (regular session close)
 *   ahEnd    — 20:00 ET  (after-hours close)
 *
 * All values are seconds since the unix epoch in UTC. nyClockToUtcMs
 * resolves DST correctly so spring-forward / fall-back days don't drift.
 */
export type SessionBoundaries = {
  pmStart: number;
  rthStart: number;
  rthEnd: number;
  ahEnd: number;
};

export function computeSessionBoundaries(etDateIso: string): SessionBoundaries {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(etDateIso);
  if (!m) {
    throw new Error(
      `computeSessionBoundaries: invalid ET date "${etDateIso}", expected YYYY-MM-DD`,
    );
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const toSeconds = (h: number, mins: number) =>
    Math.floor(nyClockToUtcMs(year, month, day, h, mins) / 1000);
  return {
    pmStart: toSeconds(4, 0),
    rthStart: toSeconds(9, 30),
    rthEnd: toSeconds(16, 0),
    ahEnd: toSeconds(20, 0),
  };
}
