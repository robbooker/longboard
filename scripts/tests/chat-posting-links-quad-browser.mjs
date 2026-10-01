// Integration checks inside the actual four-pane fixture, after Quad follow checks.
import assert from 'node:assert/strict';

export async function verifyPostingLinksQuad({ p, pane, base, writes }) {
  const preview = 'nav[aria-label="Links in your draft"]';
  const scroll = i => `${pane(i)} [aria-live="polite"][aria-busy]`;
  const input = i => `${pane(i)} ${i >= 2 ? 'textarea[placeholder="Write a private message…"]' : 'textarea[aria-label^="Message "]'}`;
  const skip = i => `${pane(i)} button[aria-label="Skip to Most Recent Message"]`;
  const bottom = i => p.waitForFunction(s => { const e = document.querySelector(s); return e && e.scrollHeight - e.clientHeight - e.scrollTop <= 2; }, {}, scroll(i));
  const sendCount = () => writes.filter(w => ['send', 'request'].includes(w.body.action)).length;
  for (let i = 0; i < 4; i++) { await p.click(skip(i)); await bottom(i); }
  // Draft growth must preserve a deliberate historical position in both kinds of pane.
  for (const i of [0, 2]) await p.$eval(scroll(i), e => { e.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true })); e.scrollTop = 100; e.dispatchEvent(new Event('scroll', { bubbles: true })); });
  const before = sendCount();
  for (let i = 0; i < 4; i++) {
    await p.type(input(i), `Pane ${i + 1} ${base}/target-${i}`);
    await p.waitForSelector(`${pane(i)} ${preview} a`);
    assert.equal(await p.$eval(`${pane(i)} ${preview} a`, e => e.href), `${base}/target-${i}`);
    assert.equal(await p.$eval(input(i), e => document.activeElement === e), true);
    assert(await p.$eval(`${pane(i)} ${preview}`, e => { const a = e.getBoundingClientRect(), b = e.closest('section[aria-label^="Pane "]').getBoundingClientRect(); return a.left >= b.left && a.right <= b.right + 1; }), 'preview fits the actual pane');
  }
  for (const i of [0, 2]) assert.equal(await p.$eval(scroll(i), e => e.scrollTop), 100, 'preview growth preserves manual history');
  for (const i of [1, 3]) await bottom(i);
  await p.click(`${pane(0)} button[aria-label="Expand pane 1"]`);
  for (const i of [1, 2, 3]) assert.equal(await p.$eval(`${pane(i)} ${preview} a`, e => e.getClientRects().length), 0, 'hidden pane links are not exposed');
  await p.click(`${pane(0)} button[aria-label="Restore four panes"]`);
  await p.screenshot({ path: '/tmp/posting-links-real-quad-desktop.png' });
  await p.setViewport({ width: 390, height: 850 });
  for (let i = 0; i < 4; i++) {
    await p.click(`nav[aria-label="Choose visible conversation"] button:nth-child(${i + 1})`);
    assert.equal(await p.$eval(input(i), e => e.value), `Pane ${i + 1} ${base}/target-${i}`, 'mobile pane switch preserves only its own draft');
    assert.equal(await p.$$eval('section[aria-label^="Pane "]:not([hidden]) nav[aria-label="Links in your draft"] a', links => links.length), 1, 'only visible pane preview participates');
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  await p.screenshot({ path: '/tmp/posting-links-real-quad-mobile.png' });
  assert.equal(sendCount(), before, 'links and pane navigation never submit drafts');
  await p.setViewport({ width: 1440, height: 1000 });
  for (let i = 0; i < 4; i++) {
    await p.click(input(i)); await p.keyboard.down('Control'); await p.keyboard.press('A'); await p.keyboard.up('Control'); await p.keyboard.press('Backspace');
    assert.equal(await p.$(`${pane(i)} ${preview}`), null, 'clearing draft removes only its preview');
    await p.click(skip(i)); await bottom(i);
  }
  console.log('Posting Links Quad integration passed: four independent drafts, pane bounds, manual scroll preservation, visible follow, hidden links, mobile switching and clear/reset.');
}
