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

export async function loadGoogleFont({ family, axes, text }: GoogleFontSpec): Promise<ArrayBuffer> {
  const url = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:${axes}&text=${encodeURIComponent(text)}`;
  // Google's CSS endpoint varies output by User-Agent. A modern UA
  // gets woff2; Satori accepts woff2. No UA header returns the older
  // TTF fallback, which also works but is bigger.
  const cssRes = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
  });
  if (!cssRes.ok) throw new Error(`font css failed: ${cssRes.status} for ${family}`);
  const css = await cssRes.text();
  const match = css.match(/src:\s*url\(([^)]+)\)\s*format\('(woff2|opentype|truetype)'\)/);
  if (!match) throw new Error(`font src not found in CSS for ${family}`);
  const fontRes = await fetch(match[1]);
  if (!fontRes.ok) throw new Error(`font bytes failed: ${fontRes.status} for ${family}`);
  return await fontRes.arrayBuffer();
}
