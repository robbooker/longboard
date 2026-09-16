// Browser regression check with a simulated account API. Real RLS is tested separately.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const base = process.env.WORKBOOK_TEST_URL || 'http://127.0.0.1:3011';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewport({ width: 1440, height: 1000 });
  let stored = { answers: { feeling: '', behavior: '', action: '', 'showing-up': '' }, evidence: Array.from({ length: 3 }, () => ({ date: '', action: '', reflection: '' })) };
  let revision = 0;
  let fail = false;
  let conflict = false;
  let saves = 0;
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    if (!req.url().includes('/api/workbooks/act-your-way')) return req.continue();
    const send = (status, body) => req.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() === 'GET') return send(200, { response: stored, revision, updatedAt: null });
    const body = JSON.parse(req.postData());
    if (fail) return send(503, { error: 'Connection interrupted. Retry before leaving.' });
    if (conflict || body.revision !== revision) return send(409, { error: 'A newer version was saved in another tab or device. Print or copy your edits, then reload.' });
    await new Promise((resolve) => setTimeout(resolve, 400));
    stored = body.response;
    revision++;
    saves++;
    return send(200, { revision, updatedAt: new Date().toISOString() });
  });
  await page.goto(`${base}/workbooks/act-your-way`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !document.querySelector('#feeling').disabled);
  const set = async (selector, value) => {
    await page.$eval(selector, (el, value) => {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  };
  const saved = () => page.waitForFunction(() => document.querySelector('[role=status]').textContent.includes('All changes saved'));
  await set('#feeling', 'Confident after a losing session.');
  await set('#behavior', 'I would review the last trade before placing another.');
  await set('#action', 'Write one honest journal entry before opening my trading platform.');
  await set('#showing-up', 'My daily review, even on the difficult days.');
  await saved();
  assert.equal(stored.answers.action, 'Write one honest journal entry before opening my trading platform.');
  // Editing while a request is in flight must queue another save.
  await set('#action', 'First version');
  await page.waitForFunction(() => document.querySelector('[role=status]').textContent.includes('Saving'));
  await set('#action', 'Write one honest journal entry before opening my trading platform.');
  await saved();
  assert.equal(stored.answers.action, 'Write one honest journal entry before opening my trading platform.');
  for (let i = 0; i < 3; i++) {
    await set(`#date-${i}`, `2026-09-${10+i}`);
    await set(`#evidence-${i}`, `I completed my review on day ${i+1}, even though I felt uncertain.`);
    await set(`#reflection-${i}`, 'The action was smaller than the fear.');
  }
  await saved();
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelector('#action').value.includes('honest journal'));
  assert.deepEqual(await page.$$eval('progress', (els) => els.map((el) => el.value)), [4, 3]);
  await page.screenshot({ path: '/tmp/workbook-filled-desktop.png', fullPage: true });
  await page.pdf({ path: '/tmp/workbook-filled-print.pdf', format: 'Letter', margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' }, printBackground: true });
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: '/tmp/workbook-filled-mobile.png', fullPage: true });
  fail = true;
  await set('#feeling', 'My edits survive a failed save.');
  await page.waitForSelector('[role=alert]');
  assert.equal(await page.$eval('#feeling', (el) => el.value), 'My edits survive a failed save.');
  fail = false;
  await page.$eval('[role=alert] button', (el) => el.click());
  await saved();
  conflict = true;
  await set('#feeling', 'Unsaved conflict edits remain available to copy.');
  await page.waitForFunction(() => document.querySelector('[role=alert]')?.textContent.includes('newer version'));
  assert.equal(await page.$eval('#feeling', (el) => el.value), 'Unsaved conflict edits remain available to copy.');
  const savesBefore = saves;
  await set('#behavior', 'No silent overwrite after a conflict.');
  await new Promise((resolve) => setTimeout(resolve, 1000));
  assert.equal(saves, savesBefore);
  assert.deepEqual(errors, []);
  console.log('PASS: fill, autosave, in-flight edits, reload, progress, mobile overflow, print, retry, conflict protection; no browser errors. API responses simulated.');
} finally { await browser.close(); }
