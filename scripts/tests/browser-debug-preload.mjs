// Loaded into each browser test by run-browser-tests.mjs (--import). When a page wait or query
// fails, saves a screenshot and the page's visible text to CHAT_BROWSER_DEBUG_DIR, so a red CI
// shard shows what the page looked like. Changes nothing else about the test.
import { Page } from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.CHAT_BROWSER_DEBUG_DIR;
if (dir) {
  let count = 0;
  const dump = async (page, method, args) => {
    if (count >= 10 || page.isClosed()) return;
    const n = ++count;
    try {
      mkdirSync(dir, { recursive: true });
      const text = await page.evaluate(() => `${location.href}\n\n${document.body?.innerText ?? ''}`).catch(e => `(no text: ${e.message})`);
      writeFileSync(join(dir, `failure-${n}.txt`), `${method}(${args.map(a => (typeof a === 'function' ? a.toString() : JSON.stringify(a))).join(', ').slice(0, 2000)})\n${text.slice(0, 20000)}`);
      await page.screenshot({ path: join(dir, `failure-${n}.png`), fullPage: false }).catch(() => {});
    } catch {}
  };
  for (const method of ['waitForSelector', 'waitForFunction', '$eval', '$$eval', 'click', 'type', 'focus', 'goto']) {
    const original = Page.prototype[method];
    if (typeof original !== 'function') continue;
    Page.prototype[method] = async function (...args) {
      try { return await original.apply(this, args); }
      catch (error) { await dump(this, method, args); throw error; }
    };
  }
}
