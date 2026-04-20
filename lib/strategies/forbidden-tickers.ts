// Hardcoded universe exclusion for strategies that forbid leveraged /
// inverse ETFs and volatility products. Per audit Q6 — the Long/Short
// Portfolio refuses anything on this list; Black Swan (planned) will
// explicitly carve out a subset.
//
// Rule: if a ProShares / Direxion / MicroSectors product's stated
// objective is any positive or negative multiple of an index, it goes
// on the list. Extend freely — one line per ticker, keep alphabetical
// within each group so additions are obvious in diffs.

export const FORBIDDEN_TICKERS: ReadonlySet<string> = new Set([
  // ── 3× bull / 3× bear broad index ──
  "SPXU", "TNA", "TQQQ", "TZA", "UPRO", "SQQQ",

  // ── Semiconductor 3× ──
  "SOXL", "SOXS",

  // ── Volatility products (futures-based) ──
  "SVIX", "SVXY", "UVIX", "UVXY", "VIXY", "VXX",

  // ── Inverse broad index (1× / 2×) ──
  "DOG", "DXD", "PSQ", "QID", "SDS", "SH",

  // ── Leveraged + inverse sector ──
  "BERZ", "BULZ", "CURE", "DRIP", "DRN", "DRV", "EDC", "EDZ",
  "ERX", "ERY", "FAS", "FAZ", "GUSH", "LABD", "LABU", "NAIL",
  "RETL", "WEBL", "YANG", "YINN",

  // ── Leveraged bonds / metals / commodities ──
  "AGQ", "BOIL", "DUST", "GLL", "JDST", "JNUG", "KOLD",
  "NUGT", "SCO", "TMF", "TMV", "UCO", "UGL", "ZSL",
]);

/** Case-insensitive check. Callers pass whatever Claude hands back; we
 *  normalize here so a lowercase ticker slip doesn't escape the filter. */
export function isForbidden(ticker: string): boolean {
  return FORBIDDEN_TICKERS.has(ticker.toUpperCase().trim());
}
