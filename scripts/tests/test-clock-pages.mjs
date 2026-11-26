// #525: loaded into a browser test whose manifest entry has `clock` (run-browser-tests.mjs, after
// test-clock.mjs). Every page the test opens gets the same moved clock as the test, its database
// and its Next server, before the page's first address loads, so no test has to do it itself.
// A window the page opens by itself (a pop-out) is not covered: it never passes through goto here.
import { Page } from 'puppeteer';
import { shiftClock } from './test-clock.mjs';

const offset = Number(process.env.CHAT_TEST_CLOCK_OFFSET_MS);
if (Number.isFinite(offset) && offset) {
  console.log(`clock pinned: New York ${new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date())}`);
  const moved = new WeakSet();
  const goto = Page.prototype.goto;
  Page.prototype.goto = async function (...args) {
    if (!moved.has(this)) {
      moved.add(this);
      await this.evaluateOnNewDocument(`(${shiftClock})(globalThis,${offset})`);
    }
    return goto.apply(this, args);
  };
}
