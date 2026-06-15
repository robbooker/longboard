export const ROB_TOP_STOCKS_LIST_ID = "rob-top-stocks";
export const ROB_TOP_STOCKS_EDITOR_EMAIL = "madspreadsheets@gmail.com";

export const DEFAULT_ROB_TOP_STOCKS = [
  "NVDA",
  "TSLA",
  "AMD",
  "PLTR",
  "SMCI",
  "HOOD",
  "COIN",
  "MSTR",
  "RGTI",
  "IONQ",
];

const TICKER_PATTERN = /^[A-Z][A-Z0-9.]{0,9}$/;

export function normalizeSharedTicker(input: string): string | null {
  const normalized = input.trim().toUpperCase().replace(/^\$/, "");
  return TICKER_PATTERN.test(normalized) ? normalized : null;
}

export function normalizeRobTopStocks(input: unknown, limit = 120): string[] {
  if (!Array.isArray(input)) return DEFAULT_ROB_TOP_STOCKS;

  const seen = new Set<string>();
  const symbols: string[] = [];
  for (const item of input) {
    if (typeof item !== "string") continue;
    const normalized = normalizeSharedTicker(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    symbols.push(normalized);
    if (symbols.length >= limit) break;
  }

  return symbols.length > 0 ? symbols : DEFAULT_ROB_TOP_STOCKS;
}

export function parseRobTopStocksText(text: string): string[] {
  return normalizeRobTopStocks(text.split(/[\s,;]+/).filter(Boolean));
}
