// Shared sign-in for the chat browser tests: the login page, then the chat with a hydrated,
// visible composer. Replaces "reload until network idle, type, submit, wait for a textarea".
//
//   await signIn(page, base, 'alice@example.test');                  // any room's composer
//   await signIn(page, base, email, { composer: 'textarea[aria-label="Message LB"]' });
//
// - Waits for the login form's React submit handler before typing: a submit before hydration
//   posts the form natively and the page just reloads.
// - The browser signs in against the synthetic Supabase fixture directly. On CI that request
//   has sometimes failed at the network level (the form shows "Failed to fetch"); that is the
//   fixture, not the app under test, so the form is submitted once more and the retry is logged
//   with the failed requests (see browser-debug-preload.mjs for the same list on failures).
// - Waits for the composer to be visible (a hidden room kept by SHELL-KEEP does not count) and
//   hydrated, with a budget for a cold dev server's first signed-in compile.
const hydrated = (selector, prop) => {
  const el = [...document.querySelectorAll(selector)].find(e => e.checkVisibility());
  const target = prop === 'onSubmit' ? el?.form : el;
  return !!target && Object.keys(target).some(k => k.startsWith('__reactProps$') && typeof target[k]?.[prop] === 'function');
};

export async function signIn(page, base, email, { composer = 'textarea[aria-label^="Message "]', password = 'demo-only', next = '/chat', timeout = 90000 } = {}) {
  const failed = [];
  const onFailed = request => failed.push(`${request.method()} ${request.url().slice(0, 160)} ${request.failure()?.errorText ?? ''}`);
  page.on('requestfailed', onFailed);
  try {
    await page.goto(`${base}/login?next=${encodeURIComponent(next)}`);
    await page.waitForFunction(hydrated, { timeout }, '#li-email', 'onSubmit');
    // The form fills in the last remembered email; replace whatever is there.
    for (const [field, value] of [['#li-email', email], ['#li-password', password]]) {
      await page.click(field, { clickCount: 3 });
      await page.keyboard.press('Backspace');
      await page.type(field, value);
    }
    for (let attempt = 0; ; attempt++) {
      await page.click('button[type="submit"]');
      const outcome = await page.waitForFunction(selector => {
        if ([...document.querySelectorAll(selector)].some(e => e.checkVisibility())) return 'chat';
        const form = document.querySelector('#li-email')?.form;
        return form && /Failed to fetch|NetworkError|Load failed/i.test(document.querySelector('.login-page')?.textContent ?? '') && !form.querySelector('button[type="submit"]')?.disabled ? 'network' : false;
      }, { timeout }, composer).then(h => h.jsonValue());
      if (outcome === 'chat') break;
      if (attempt >= 1) throw Error(`sign-in failed twice at the network level: ${failed.slice(-5).join(' | ')}`);
      console.log(`[signIn] ${email}: the sign-in request failed at the network level; submitting again. Failed requests: ${failed.slice(-5).join(' | ') || '(none seen)'}`);
    }
    await page.waitForFunction(hydrated, { timeout }, composer, 'onChange');
  } finally {
    page.off('requestfailed', onFailed);
  }
}
