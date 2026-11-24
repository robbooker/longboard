// #499: a pinned clock for browser tests whose checks depend on the Eastern time of day. A manifest
// entry with `clock: 'HH:MM'` (browser-manifest.mjs) makes run-browser-tests.mjs work out, once per
// attempt, how far the next weekday's HH:MM in New York is from now (never backwards, so sign-in
// tokens and cookies the browser keeps never look expired). It hands that to the fixture, the Next
// server and the test as CHAT_TEST_CLOCK_OFFSET_MS and loads this file into each with --import, so
// all three read the same moved clock. The clock still ticks; only the starting time is pinned.
// PGlite reads the time from JavaScript, so the fixture's now() moves with it. The test passes
// shiftClock to the browser page (page.evaluateOnNewDocument) so the page agrees too.
// Test-only: nothing in the app reads CHAT_TEST_CLOCK_OFFSET_MS.

/** Moves `scope`'s Date by `offset` ms: Date.now(), new Date() and Date(). Self-contained (also runs in a page). */
export function shiftClock(scope, offset) {
  const Real = scope.Date;
  if (!Number.isFinite(offset) || !offset || Real.testClockOffset !== undefined) return;
  const now = () => Real.now() + offset;
  // A plain function carrying every one of Date's own properties (parse, UTC, prototype...), so the
  // real Date's prototype and instanceof keep working, and Next's own Date wrapper (which copies
  // only own properties) still finds them. Date() without new answers a string, like the real one.
  function TestDate(...args) {
    if (new.target === undefined) return new Real(now()).toString();
    return Reflect.construct(Real, args.length ? args : [now()], new.target);
  }
  Object.defineProperties(TestDate, Object.getOwnPropertyDescriptors(Real));
  Object.defineProperty(TestDate, 'now', { value: () => now(), writable: true, configurable: true });
  Object.defineProperty(TestDate, 'testClockOffset', { value: offset });
  scope.Date = TestDate;
}

/** Milliseconds from `from` to the next weekday's `hhmm` ("09:00") in New York, at or after `from`. */
export function offsetToEastern(hhmm, from = Date.now()) {
  const [hour, minute] = hhmm.split(':').map(Number);
  const parts = at => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at).map(p => [p.type, p.value]));
  // The Eastern wall time `day` at hour:minute as an instant (New York's offset read at that moment).
  const eastern = day => {
    const guess = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, minute);
    const p = parts(guess);
    return guess + (guess - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second));
  };
  const today = parts(from);
  for (let i = 0; i < 8; i++) {
    const day = new Date(Date.UTC(+today.year, +today.month - 1, +today.day + i, 12));
    const at = eastern(day);
    if (day.getUTCDay() % 6 && at >= from) return at - from;
  }
  throw Error(`no weekday ${hhmm} found`);
}

shiftClock(globalThis, Number(process.env.CHAT_TEST_CLOCK_OFFSET_MS));
