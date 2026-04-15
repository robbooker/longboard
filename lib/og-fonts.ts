/** Google Fonts has no public API for raw font bytes, but its CSS2
 *  endpoint serves a @font-face rule whose src URL points at the woff2.
 *  Passing `text=` returns a subset covering only the glyphs we need
 *  — keeps the OG cold start fast and the edge response under the
 *  size cap. Shared between /learn/opengraph-image.tsx and
 *  /learn/[slug]/opengraph-image.tsx. */

type GoogleFontSpec = {
  family: string;
  /** CSS2 axis spec, e.g. "ital,wght@0,500" or "wght@500". */
  axes: string;
  text: string;
};

/** Vercel's build infra occasionally hits Google Fonts with ETIMEDOUT.
 *  Two retries with exponential backoff keeps transient network hiccups
 *  from failing the whole deploy. Fetches inside loadGoogleFont — the
 *  CSS endpoint + the woff2 endpoint — each go through this wrapper. */
async function fetchWithRetry(url: string, init: RequestInit = {}, attempts = 3): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function loadGoogleFont({ family, axes, text }: GoogleFontSpec): Promise<ArrayBuffer> {
  const url = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:${axes}&text=${encodeURIComponent(text)}`;
  // Google's CSS endpoint varies output by User-Agent. A modern UA
  // gets woff2; Satori accepts woff2. No UA header returns the older
  // TTF fallback, which also works but is bigger.
  const cssRes = await fetchWithRetry(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
  });
  const css = await cssRes.text();
  // Match any src: url(...) — Google returns a single @font-face per
  // weight/style combo with a single url. Format marker varies
  // (woff2, truetype, etc.) and is sometimes missing entirely, so
  // we don't constrain on it. Strip surrounding whitespace and
  // optional quotes from the captured URL.
  const match = css.match(/src:\s*url\(\s*['"]?([^'")\s]+)['"]?\s*\)/);
  if (!match) throw new Error(`font src not found in CSS for ${family}. CSS was: ${css.slice(0, 400)}`);
  const fontRes = await fetchWithRetry(match[1]);
  return await fontRes.arrayBuffer();
}
