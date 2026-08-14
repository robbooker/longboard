import { scanRvolBuySignals, type RvolScannerHit } from "@/lib/scanners/rvolScanner";

const SYSTEM_PROMPT = `
You are Pedro, the helpful AI assistant for Longboard members.
You help with trading questions, stock analysis, platform questions, and general market thinking.
Be concise, practical, and friendly.
Never promise profits, never give guaranteed financial advice, and remind users that they are responsible for their own trades when appropriate.
If a question needs live market data you do not have, say so plainly and offer a general framework instead.
You do have access to Longboard scanner data when users ask about the scanner, RVOL scanner, top scanner names, scanner ranks, or buy signals.
`.trim();

const SEC_USER_AGENT =
  process.env.SEC_USER_AGENT || "LongboardAI PedroBot contact@longboardai.com";
const POLYGON_BASE_URL = "https://api.polygon.io";
const ASKEDGAR_BASE_URL =
  process.env.ASKEDGAR_API_BASE_URL || process.env.ASKEDGAR_BASE_URL || "https://eapi.askedgar.io";
const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";

type JsonObject = Record<string, unknown>;

export type PedroChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type PedroAnswer = {
  intent: string;
  text: string;
};

type Bar = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
  vw?: number;
};

let secTickerCache: Promise<Array<{ cik_str: number; ticker: string; title: string }>> | null = null;

function possibleTickers(message = ""): string[] {
  const ignoredWords = new Set([
    "CAN",
    "YOU",
    "THE",
    "SEC",
    "EDGAR",
    "FILING",
    "FILINGS",
    "CHECK",
    "PULL",
    "REVIEW",
    "QUOTE",
    "CHART",
    "PRICE",
    "RISK",
    "DILUTION",
    "ASKEDGAR",
    "FLOAT",
    "SHELF",
    "SHELVES",
    "ATM",
    "REGISTRATION",
    "REGISTRATIONS",
    "OUTSTANDING",
    "COMPLIANCE",
    "MARKET",
    "DATA",
    "TECHNICAL",
    "TECHNICALS",
    "TARGET",
    "TARGETS",
    "LEVEL",
    "LEVELS",
    "UPSIDE",
    "DOWNSIDE",
    "ENTRY",
    "STOP",
    "INVALIDATION",
    "ON",
    "FOR",
    "ABOUT",
    "WHAT",
    "WHATS",
    "IS",
    "NUMBER",
    "ONE",
    "TWO",
    "THREE",
    "FOUR",
    "FIVE",
    "SIX",
    "SEVEN",
    "EIGHT",
    "NINE",
    "TEN",
    "STOCK",
    "STOCKS",
    "TOP",
    "LONGBOARD",
    "SCANNER",
    "RVOL",
    "BUY",
    "SIGNAL",
    "SIGNALS",
    "CURRENT",
    "LIVE",
    "NOW",
    "RANK",
    "RANKED",
    "SHOW",
    "LIST",
    "NAME",
    "NAMES",
    "ME",
    "PLEASE",
    "PLS",
    "LOOK",
  ]);
  const candidates: string[] = [];

  for (const match of message.matchAll(
    /\b(?:for|on|about|ticker|symbol|research|analyze|analysis|brief|report|dd|quote|chart|price|target|targets|level|levels|technical|technicals|risk|dilution|shelf|shelves|atm|registration|registrations|float|outstanding|compliance)\s+\$?([A-Z][A-Z0-9.-]{0,7})\b/gi,
  )) {
    candidates.push(match[1]);
  }

  for (const match of message.matchAll(/\$([A-Z][A-Z0-9.-]{0,7})\b/g)) {
    candidates.push(match[1]);
  }

  for (const match of message.matchAll(/\b([A-Z][A-Z0-9.-]{1,7})\b/g)) {
    candidates.push(match[1]);
  }

  return [...new Set(candidates.map((word) => word.toUpperCase().replace(".", "-")))].filter(
    (word) => !ignoredWords.has(word),
  );
}

function tickersFor(message: string, intentPattern: RegExp): string[] {
  if (!intentPattern.test(message)) return [];
  return possibleTickers(message);
}

function isHelpRequest(message = ""): boolean {
  return /\b(help|commands|command list|what can you do|how do i use|how to use|pedro help)\b/i.test(
    message,
  );
}

function parseGermanTranslationCommand(message = ""): { inlineText: string } | null {
  const trimmed = message.trim();
  const patterns = [
    /^(?:\/?german|\/?deutsch|\/?de)\b[\s:,-]*([\s\S]*)$/i,
    /^translate(?:\s+this)?\s+(?:to|into)\s+german\b[\s:,-]*([\s\S]*)$/i,
    /^in\s+german\b[\s:,-]*([\s\S]*)$/i,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) {
      const inlineText = (match[1] || "").trim();
      return {
        inlineText: /^(please|pls)[!.]?$/i.test(inlineText) ? "" : inlineText,
      };
    }
  }

  return null;
}

function buildHelpResponse(): string {
  return `Pedro Commands

Translation
- /german Good morning team - translate inline text into German.
- /german - translate your previous message in this chat.

SEC filings
- filings BZFD - pull recent SEC filings and summarize them.
- check SEC filings on BZFD - same idea, more natural language.

Market data
- quote BZFD - price, change, volume, moving averages, and ATR-style range.
- chart BZFD - same market snapshot with chart context.
- targets TDIC - live above/below target levels from Polygon.

Longboard scanner
- scanner - show the current top Longboard RVOL scanner names.
- #1 on scanner - show the current top-ranked scanner stock.
- scanner TDIC - check whether a ticker is on the current scanner list.

AskEdgar risk tools
- risk BZFD - dilution/risk snapshot.
- dilution BZFD - same as risk, focused on raise risk.
- shelf TDIC - shelf/ATM/registration records.
- float TDIC - float, outstanding shares, market cap.
- compliance TDIC - Nasdaq compliance issues.

All-in-one research
- research TDIC - AskEdgar + Polygon + SEC filings into one research brief.
- analyze TDIC - same all-in-one research flow.

General questions
- Ask normal trading, platform, or market questions and I will answer directly.

I provide research and checklists, not financial advice. You are responsible for your own trades.`;
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    throw new Error(`${response.status} ${typeof payload === "object" && payload ? JSON.stringify(payload).slice(0, 180) : text}`);
  }
  return payload;
}

async function secFetchJson(url: string): Promise<unknown> {
  return fetchJson(url, {
    headers: {
      "User-Agent": SEC_USER_AGENT,
      Accept: "application/json",
    },
  });
}

async function secFetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "User-Agent": SEC_USER_AGENT,
      Accept: "text/html,text/plain,application/xhtml+xml",
    },
  });
  if (!response.ok) throw new Error(`SEC filing fetch failed: ${response.status}`);
  return response.text();
}

async function polygonFetchJson(path: string, params: Record<string, string | number | boolean | null | undefined> = {}): Promise<JsonObject> {
  const key = process.env.POLYGON_API_KEY;
  if (!key) throw new Error("POLYGON_API_KEY is not installed");

  const url = new URL(`${POLYGON_BASE_URL}${path}`);
  for (const [paramKey, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(paramKey, String(value));
  }
  url.searchParams.set("apiKey", key);

  const data = await fetchJson(url.toString());
  return data && typeof data === "object" && !Array.isArray(data) ? data as JsonObject : {};
}

async function askEdgarFetchJson(path: string, params: Record<string, string | number> = {}): Promise<JsonObject> {
  const key = process.env.ASKEDGAR_API_KEY;
  if (!key) throw new Error("ASKEDGAR_API_KEY is not installed");

  const url = new URL(`${ASKEDGAR_BASE_URL.replace(/\/+$/, "")}${path}`);
  for (const [paramKey, value] of Object.entries(params)) {
    url.searchParams.set(paramKey, String(value));
  }

  const data = await fetchJson(url.toString(), {
    headers: {
      "API-KEY": key,
      Accept: "application/json",
    },
  });
  return data && typeof data === "object" && !Array.isArray(data) ? data as JsonObject : {};
}

function isoDateDaysAgo(daysAgo: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function formatPrice(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  if (Math.abs(number) >= 100) return `$${number.toFixed(2)}`;
  if (Math.abs(number) >= 1) return `$${number.toFixed(3)}`;
  return `$${number.toFixed(4)}`;
}

function formatNumber(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  if (Math.abs(number) >= 1_000_000_000) return `${(number / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(number) >= 1_000_000) return `${(number / 1_000_000).toFixed(2)}M`;
  if (Math.abs(number) >= 1_000) return `${(number / 1_000).toFixed(2)}K`;
  return number.toFixed(0);
}

function formatPercent(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  return `${number >= 0 ? "+" : ""}${number.toFixed(2)}%`;
}

function formatDateTimeEt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "n/a";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function parseScannerRank(message: string): number | null {
  const numeric = message.match(/\b(?:#|number\s*)?([1-9]|10)\b/i);
  if (numeric) return Number(numeric[1]);

  const words: Record<string, number> = {
    one: 1,
    first: 1,
    two: 2,
    second: 2,
    three: 3,
    third: 3,
    four: 4,
    fourth: 4,
    five: 5,
    fifth: 5,
    six: 6,
    sixth: 6,
    seven: 7,
    seventh: 7,
    eight: 8,
    eighth: 8,
    nine: 9,
    ninth: 9,
    ten: 10,
    tenth: 10,
  };
  const word = message.match(/\b(one|first|two|second|three|third|four|fourth|five|fifth|six|sixth|seven|seventh|eight|eighth|nine|ninth|ten|tenth)\b/i);
  return word ? words[word[1].toLowerCase()] : null;
}

function parseScannerCount(message: string): number {
  const explicitTop = message.match(/\btop\s+([1-9]|10)\b/i);
  if (explicitTop) return Number(explicitTop[1]);
  if (/\b(top|leaders?|leaderboard|list|names?|stocks?)\b/i.test(message)) return 5;
  return parseScannerRank(message) ? 1 : 5;
}

function isScannerRequest(message = ""): boolean {
  return /\b(longboard\s+scanner|scanner|rvol|relative volume|buy signals?|momentum scan|top\s+(?:stocks?|names?|scanner)|#\s*1\s+(?:stock|name)|number\s+1\s+(?:stock|name))\b/i.test(
    message,
  );
}

function formatScannerHit(row: RvolScannerHit, index: number, detailed = false): string {
  const base = `#${index + 1} ${row.ticker}${row.name ? ` - ${row.name}` : ""}
- Price now: ${formatPrice(row.priceNow)}
- Move: ${formatPercent(row.changePct)}
- Signal: ${formatPrice(row.signalPrice)} at ${row.signalTimeEt} ET / ${row.signalRvol.toFixed(1)}x RVOL
- Volume: ${formatNumber(row.dayVolume)} (${formatMaybeMoney(row.dollarVolume)})`;

  if (!detailed) return base;

  return `${base}
- Why it is here: common operating stock, at least the scanner minimum price/move, then an RVOL momentum signal after the scanner start window.
- Next checks: catalyst, spread/liquidity, dilution risk, and target levels. Try \`research ${row.ticker}\`, \`risk ${row.ticker}\`, or \`targets ${row.ticker}\`.`;
}

function formatScannerAnswer({
  message,
  hits,
  fetchedAt,
  etDate,
  scanned,
}: {
  message: string;
  hits: RvolScannerHit[];
  fetchedAt: string;
  etDate: string;
  scanned: number;
}): string {
  const tickers = possibleTickers(message);
  const requestedTicker = tickers.find((ticker) =>
    hits.some((hit) => hit.ticker.toUpperCase() === ticker),
  );
  const asksForList = /\b(top|leaders?|leaderboard|list|names?|stocks?)\b/i.test(message);
  const rank = asksForList ? null : parseScannerRank(message);

  if (!hits.length) {
    return `Longboard scanner

No active RVOL scanner hits are showing right now for ${etDate}.

I scanned ${scanned} common-stock candidates. Check again in a bit, especially during the regular session when fresh volume can change the board quickly.`;
  }

  if (requestedTicker) {
    const row = hits.find((hit) => hit.ticker.toUpperCase() === requestedTicker)!;
    const index = hits.indexOf(row);
    return `Longboard scanner: ${requestedTicker}
Fetched ${formatDateTimeEt(fetchedAt)} for ${etDate}

${formatScannerHit(row, index, true)}

Not financial advice. Use the scanner as a research queue, not a buy button.`;
  }

  const requestedMissingTicker = tickers[0];
  if (requestedMissingTicker && !asksForList && !rank) {
    const preview = hits.slice(0, 5).map((hit, index) => `#${index + 1} ${hit.ticker} (${formatPercent(hit.changePct)}, ${hit.signalRvol.toFixed(1)}x RVOL)`).join("\n");
    return `Longboard scanner: ${requestedMissingTicker}
Fetched ${formatDateTimeEt(fetchedAt)} for ${etDate}

${requestedMissingTicker} is not in the current active RVOL scanner hits.

Current top names:
${preview}

If you want the full ticker research anyway, ask \`research ${requestedMissingTicker}\` or \`targets ${requestedMissingTicker}\`.

Not financial advice.`;
  }

  if (rank) {
    const row = hits[rank - 1];
    if (!row) {
      return `The Longboard scanner only has ${hits.length} active hit${hits.length === 1 ? "" : "s"} right now, so I do not have a #${rank} to show.`;
    }

    return `Longboard scanner #${rank}
Fetched ${formatDateTimeEt(fetchedAt)} for ${etDate}

${formatScannerHit(row, rank - 1, true)}

Not financial advice. Use the scanner as a research queue, not a buy button.`;
  }

  const count = Math.min(parseScannerCount(message), hits.length);
  const rows = hits.slice(0, count).map((hit, index) => formatScannerHit(hit, index)).join("\n\n");

  return `Longboard scanner top ${count}
Fetched ${formatDateTimeEt(fetchedAt)} for ${etDate}

${rows}

Sorted by the current scanner ranking. Ask \`scanner TICKER\` for one name, or \`targets TICKER\` / \`risk TICKER\` for follow-up work.

Not financial advice. Use the scanner as a research queue, not a buy button.`;
}

async function handleScannerRequest(message: string): Promise<PedroAnswer | null> {
  if (!isScannerRequest(message)) return null;
  if (!process.env.POLYGON_API_KEY) {
    return { intent: "scanner", text: "I can read the Longboard scanner once my Polygon API key is installed." };
  }

  try {
    const result = await scanRvolBuySignals();
    return {
      intent: "scanner",
      text: formatScannerAnswer({
        message,
        hits: result.hits,
        fetchedAt: result.fetchedAt,
        etDate: result.etDate,
        scanned: result.scanned,
      }),
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown scanner error.";
    return {
      intent: "scanner",
      text: `I tried to read the Longboard scanner, but the scanner request failed: ${detail}`,
    };
  }
}

function average(values: Array<number | undefined>): number | null {
  const clean = values.filter((value): value is number => Number.isFinite(value));
  if (!clean.length) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function sma(bars: Bar[], period: number): number | null {
  if (bars.length < period) return null;
  return average(bars.slice(-period).map((bar) => bar.c));
}

function atr(bars: Bar[], period = 14): number | null {
  if (bars.length < period + 1) return null;
  const trueRanges = bars.slice(-(period + 1)).map((bar, index, selected) => {
    if (index === 0) return undefined;
    const previousClose = selected[index - 1].c;
    return Math.max(bar.h - bar.l, Math.abs(bar.h - previousClose), Math.abs(bar.l - previousClose));
  });
  return average(trueRanges);
}

function timestampDate(timestamp: number | undefined): string {
  return timestamp ? new Date(timestamp).toISOString().slice(0, 10) : "n/a";
}

function jsonArray<T>(value: unknown, guard: (item: unknown) => item is T): T[] {
  return Array.isArray(value) ? value.filter(guard) : [];
}

function isBar(item: unknown): item is Bar {
  const row = item as Partial<Bar>;
  return !!row && typeof row.t === "number" && typeof row.o === "number" && typeof row.h === "number" && typeof row.l === "number" && typeof row.c === "number";
}

async function fetchDailyBars(ticker: string): Promise<Bar[]> {
  const data = await polygonFetchJson(
    `/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${isoDateDaysAgo(430)}/${isoDateDaysAgo(0)}`,
    { adjusted: true, sort: "asc", limit: 5000 },
  );
  return jsonArray(data.results, isBar);
}

async function fetchIntradayBars(ticker: string): Promise<Bar[]> {
  const today = isoDateDaysAgo(0);
  const data = await polygonFetchJson(
    `/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/5/minute/${today}/${today}`,
    { adjusted: true, sort: "asc", limit: 5000 },
  );
  return jsonArray(data.results, isBar);
}

async function fetchPolygonSnapshot(ticker: string): Promise<JsonObject | null> {
  try {
    const data = await polygonFetchJson("/v3/snapshot", {
      "ticker.any_of": ticker,
      limit: 1,
    });
    const results = Array.isArray(data.results) ? data.results : [];
    const first = results[0];
    return first && typeof first === "object" && !Array.isArray(first) ? first as JsonObject : null;
  } catch {
    return null;
  }
}

function marketBias({ lastClose, sma20, sma50 }: { lastClose: number; sma20: number | null; sma50: number | null }): string {
  if (!sma20 || !sma50) return "not enough data for a moving-average read";
  if (lastClose > sma20 && sma20 > sma50) return "bullish short-term structure";
  if (lastClose < sma20 && sma20 < sma50) return "bearish short-term structure";
  if (lastClose > sma20 && lastClose < sma50) return "rebounding but still below the 50-day";
  if (lastClose < sma20 && lastClose > sma50) return "pulling back inside a broader base";
  return "mixed structure";
}

function buildMarketDataSummary({ ticker, bars, snapshot }: { ticker: string; bars: Bar[]; snapshot: JsonObject | null }): string {
  const last = bars.at(-1);
  const previous = bars.at(-2);
  if (!last) return `Polygon did not return enough daily bars for ${ticker}.`;

  const recent20 = bars.slice(-20);
  const recent60 = bars.slice(-60);
  const high20 = Math.max(...recent20.map((bar) => bar.h));
  const low20 = Math.min(...recent20.map((bar) => bar.l));
  const high60 = Math.max(...recent60.map((bar) => bar.h));
  const low60 = Math.min(...recent60.map((bar) => bar.l));
  const sma20 = sma(bars, 20);
  const sma50 = sma(bars, 50);
  const avgVol20 = average(recent20.map((bar) => bar.v));
  const range = atr(bars, 14);
  const change = previous ? last.c - previous.c : null;
  const changePercent = previous ? (change! / previous.c) * 100 : null;
  const session = snapshot?.session && typeof snapshot.session === "object" ? snapshot.session as JsonObject : {};

  const latestPrice = Number(session.price) || Number((snapshot?.last_trade as JsonObject | undefined)?.price) || last.c;
  const sessionChangePercent = Number(session.change_percent) || changePercent;
  const sessionVolume = Number(session.volume) || last.v;
  const volumeVsAvg = avgVol20 && sessionVolume ? (Number(sessionVolume) / avgVol20) * 100 : null;

  return `Market snapshot for ${ticker}
- Latest available price: ${formatPrice(latestPrice)} (${formatPercent(sessionChangePercent)}); latest daily bar: ${timestampDate(last.t)}
- Last daily OHLC: open ${formatPrice(last.o)}, high ${formatPrice(last.h)}, low ${formatPrice(last.l)}, close ${formatPrice(last.c)}
- Volume: ${formatNumber(sessionVolume)} vs 20-day avg ${formatNumber(avgVol20)}${volumeVsAvg ? ` (${volumeVsAvg.toFixed(0)}% of avg)` : ""}
- 20-day SMA: ${formatPrice(sma20)}; 50-day SMA: ${formatPrice(sma50)}
- 14-day ATR-style range: ${formatPrice(range)}${range ? ` (${((range / last.c) * 100).toFixed(2)}% of price)` : ""}
- Recent levels: 20-day range ${formatPrice(low20)} - ${formatPrice(high20)}; 60-day range ${formatPrice(low60)} - ${formatPrice(high60)}
- Read: ${marketBias({ lastClose: last.c, sma20, sma50 })}

Checklist:
- If volume is unusually high, look for a news/filing catalyst.
- Watch whether price accepts above/below the 20-day and 50-day averages.
- Treat ATR as a rough daily movement guide, not a prediction.

Not financial advice. Use this as a market context checklist, not a trade signal.`;
}

async function handleMarketDataRequest(message: string): Promise<PedroAnswer | null> {
  const tickers = tickersFor(message, /\b(quote|price|chart|market data|snapshot|candles?|technical|technicals|moving averages?|volume|atr)\b/i);
  if (!tickers.length) return null;
  if (!process.env.POLYGON_API_KEY) {
    return { intent: "market", text: "I can pull market data once my Polygon API key is installed." };
  }

  const ticker = tickers[0];
  const [bars, snapshot] = await Promise.all([fetchDailyBars(ticker), fetchPolygonSnapshot(ticker)]);
  return { intent: "market", text: buildMarketDataSummary({ ticker, bars, snapshot }) };
}

function easternDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function easternMinuteOfDay(timestamp: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(timestamp));
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function roundTargetLevel(value: unknown): number | null {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  if (number < 1) return Number(number.toFixed(4));
  if (number < 10) return Number(number.toFixed(3));
  return Number(number.toFixed(2));
}

function uniqueSortedLevels(levels: Array<[string, unknown]>, reverse = false): Array<[string, number]> {
  const cleaned: Array<[string, number]> = [];
  for (const [label, rawValue] of levels) {
    const value = roundTargetLevel(rawValue);
    if (!value) continue;
    if (cleaned.some(([, existing]) => Math.abs(existing - value) / Math.max(value, 0.01) < 0.004)) continue;
    cleaned.push([label, value]);
  }
  return cleaned.sort((a, b) => (reverse ? b[1] - a[1] : a[1] - b[1]));
}

function maxLevel(bars: Bar[], key: "h" | "l" | "c" | "o"): number | null {
  const values = bars.map((bar) => Number(bar[key])).filter(Number.isFinite);
  return values.length ? Math.max(...values) : null;
}

function minLevel(bars: Bar[], key: "h" | "l" | "c" | "o"): number | null {
  const values = bars.map((bar) => Number(bar[key])).filter(Number.isFinite);
  return values.length ? Math.min(...values) : null;
}

async function fetchTickerReference(ticker: string): Promise<JsonObject | null> {
  try {
    const data = await polygonFetchJson(`/v3/reference/tickers/${encodeURIComponent(ticker)}`);
    return data.results && typeof data.results === "object" && !Array.isArray(data.results) ? data.results as JsonObject : null;
  } catch {
    return null;
  }
}

function buildTargetPlan({ ticker, reference, dailyBars, intradayBars, snapshot }: {
  ticker: string;
  reference: JsonObject | null;
  dailyBars: Bar[];
  intradayBars: Bar[];
  snapshot: JsonObject | null;
}) {
  const todayKey = easternDateKey();
  const todayBars = intradayBars.filter((bar) => easternDateKey(new Date(bar.t)) === todayKey);
  const premarketBars = todayBars.filter((bar) => easternMinuteOfDay(bar.t) < 9 * 60 + 30);
  const regularBars = todayBars.filter((bar) => {
    const minute = easternMinuteOfDay(bar.t);
    return minute >= 9 * 60 + 30 && minute <= 16 * 60;
  });

  const todayDailyBar = dailyBars.at(-1);
  const previousDailyBar = dailyBars.at(-2);
  const priorDailyBars = dailyBars.filter((bar) => easternDateKey(new Date(bar.t)) < todayKey);
  const session = snapshot?.session && typeof snapshot.session === "object" ? snapshot.session as JsonObject : {};
  const last =
    Number(session.price) ||
    Number((snapshot?.last_trade as JsonObject | undefined)?.price) ||
    Number(regularBars.at(-1)?.c) ||
    Number(todayBars.at(-1)?.c) ||
    Number(todayDailyBar?.c) ||
    null;

  if (!Number.isFinite(last) || !last || last <= 0) throw new Error(`Polygon did not return a usable live price for ${ticker}`);

  const previousClose = Number(previousDailyBar?.c) || Number(session.previous_close) || null;
  const changePercent = Number(session.change_percent) || (previousClose ? ((last - previousClose) / previousClose) * 100 : null);
  const dayHigh = maxLevel(regularBars, "h") || Number(todayDailyBar?.h) || Number(session.high) || null;
  const dayLow = minLevel(regularBars, "l") || Number(todayDailyBar?.l) || Number(session.low) || null;
  const dayRange = dayHigh && dayLow ? Math.max(dayHigh - dayLow, 0) : 0;
  const range = atr(priorDailyBars.length ? priorDailyBars : dailyBars, 14) || 0;
  const volatilityUnit = Math.max(range * 0.75, dayRange * 0.55, last * 0.045);
  const extensionUnit = Math.max(range * 1.2, dayRange * 0.9, last * 0.09);
  const vwap = Number(session.vwap) || Number(todayDailyBar?.vw) || null;
  const volume = Number(session.volume) || todayBars.reduce((sum, bar) => sum + (Number(bar.v) || 0), 0) || Number(todayDailyBar?.v) || null;

  const aboveCandidates = uniqueSortedLevels([
    ["premarket high", maxLevel(premarketBars, "h")],
    ["regular-session high", maxLevel(regularBars, "h")],
    ["day high", dayHigh],
    ["20-day high", maxLevel(priorDailyBars.slice(-20), "h")],
  ]);
  const above = aboveCandidates.filter(([, level]) => level >= last * 1.012);

  const belowCandidates = uniqueSortedLevels(
    [
      ["VWAP", vwap],
      ["premarket low", minLevel(premarketBars, "l")],
      ["regular-session low", minLevel(regularBars, "l")],
      ["day low", dayLow],
      ["previous close", previousClose],
      ["20-day low", minLevel(priorDailyBars.slice(-20), "l")],
    ],
    true,
  );
  const below = belowCandidates.filter(([, level]) => level <= last * 0.988);

  const target1 = above[0] || ["range extension", last + volatilityUnit] as [string, number];
  const target2 = above.find(([, level]) => level >= target1[1] * 1.012 && level !== target1[1]) || ["momentum extension", Math.max(target1[1] + volatilityUnit * 0.7, last + extensionUnit)] as [string, number];
  const support1 = below[0] || ["first pullback zone", last - volatilityUnit * 0.65] as [string, number];
  const support2 = below.find(([, level]) => level <= support1[1] * 0.988 && level !== support1[1]) || ["risk extension", Math.min(support1[1] - volatilityUnit * 0.6, last - extensionUnit)] as [string, number];

  return {
    ticker,
    name: typeof reference?.name === "string" ? reference.name : ticker,
    last: roundTargetLevel(last),
    changePercent,
    volume,
    upside1: { price: roundTargetLevel(target1[1]), basis: target1[0] },
    upside2: { price: roundTargetLevel(target2[1]), basis: target2[0] },
    downside1: { price: roundTargetLevel(support1[1]), basis: support1[0] },
    downside2: { price: roundTargetLevel(support2[1]), basis: support2[0] },
    invalidation: roundTargetLevel(support2[1]),
    atr: roundTargetLevel(range),
    vwap: roundTargetLevel(vwap),
    intradayBarCount: todayBars.length,
  };
}

function formatTargetPlan(plan: ReturnType<typeof buildTargetPlan>): string {
  const confidence = plan.intradayBarCount ? "Medium" : "Low";
  return `Pedro targets: ${plan.ticker}
${plan.name}

Current
- Last: ${formatPrice(plan.last)} (${formatPercent(plan.changePercent)})
- Volume: ${formatNumber(plan.volume)}

Above price
- T1: ${formatPrice(plan.upside1.price)} - ${plan.upside1.basis}
- T2: ${formatPrice(plan.upside2.price)} - ${plan.upside2.basis}

Below price
- D1: ${formatPrice(plan.downside1.price)} - ${plan.downside1.basis}
- D2: ${formatPrice(plan.downside2.price)} - ${plan.downside2.basis}

D1/D2 definitions
- D1 is the first downside reference level where momentum may be weakening.
- D2 is the deeper failure/invalidation level for the current setup.

Read
- Confidence: ${confidence}
- Reason: These levels are built from current price, VWAP, intraday range, premarket levels, previous close, and recent daily range.
- Risk: If ${plan.ticker} loses ${formatPrice(plan.invalidation)}, the setup has changed and the downside scenario matters more.

Scenario levels only. Not financial advice.`;
}

async function handleTargetRequest(message: string): Promise<PedroAnswer | null> {
  const tickers = tickersFor(message, /\b(target|targets|levels?|upside|downside|entry|stop|invalidation)\b/i);
  if (!tickers.length) return null;
  if (!process.env.POLYGON_API_KEY) {
    return { intent: "targets", text: "I can build live target levels once my Polygon API key is installed." };
  }

  const ticker = tickers[0];
  const [dailyBars, intradayBars, snapshot, reference] = await Promise.all([
    fetchDailyBars(ticker),
    fetchIntradayBars(ticker).catch(() => []),
    fetchPolygonSnapshot(ticker),
    fetchTickerReference(ticker),
  ]);

  if (dailyBars.length < 2 && !snapshot) {
    return { intent: "targets", text: `I checked Polygon for ${ticker}, but there was not enough price data to build target levels.` };
  }

  return { intent: "targets", text: formatTargetPlan(buildTargetPlan({ ticker, reference, dailyBars, intradayBars, snapshot })) };
}

function field(record: JsonObject | null, keys: string[]): unknown {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function findResults(data: JsonObject): JsonObject[] {
  if (Array.isArray(data.results)) return data.results.filter((item): item is JsonObject => !!item && typeof item === "object" && !Array.isArray(item));
  if (Array.isArray(data.data)) return data.data.filter((item): item is JsonObject => !!item && typeof item === "object" && !Array.isArray(item));
  if (data.result && typeof data.result === "object" && !Array.isArray(data.result)) return [data.result as JsonObject];
  return [];
}

async function fetchAskEdgarEndpoint(path: string, ticker: string): Promise<JsonObject[]> {
  const data = await askEdgarFetchJson(path, { ticker, limit: 5 });
  return findResults(data);
}

function formatMaybeMoney(value: unknown): string {
  if (value === undefined || value === null || value === "") return "n/a";
  return `$${formatNumber(value)}`;
}

function formatRiskValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "n/a";
  if (value === true || String(value).toLowerCase() === "true") return "Yes";
  if (value === false || String(value).toLowerCase() === "false") return "No";
  return String(value);
}

function askEdgarIntent(message = ""): "registrations" | "float" | "compliance" | "risk" {
  if (/\b(shelf|shelves|atm|registration|registrations)\b/i.test(message)) return "registrations";
  if (/\b(float|outstanding|shares outstanding)\b/i.test(message)) return "float";
  if (/\b(nasdaq compliance|compliance|bid price|delisting)\b/i.test(message)) return "compliance";
  return "risk";
}

function summarizeRisk(rating: JsonObject | null, registrations: JsonObject[], compliance: JsonObject[], floatData: JsonObject[], ticker: string): string {
  if (!rating) return `AskEdgar did not return a dilution/risk rating for ${ticker}.`;
  const riskFields: Array<[string, string[]]> = [
    ["Overall offering risk", ["overall_offering_risk"]],
    ["Offering ability", ["offering_ability"]],
    ["Dilution", ["dilution"]],
    ["Offering frequency", ["offering_frequency"]],
    ["Cash need", ["cash_need"]],
    ["Nasdaq compliance", ["nasdaq_compliance"]],
    ["Reg SHO", ["regsho"]],
  ];
  const riskLines = riskFields
    .map(([label, keys]) => {
      const value = field(rating, keys);
      const detail = field(rating, keys.map((key) => `${key}_desc`));
      return value === null ? null : `- ${label}: ${formatRiskValue(value)}${detail ? ` (${detail})` : ""}`;
    })
    .filter(Boolean);
  const metricLines = [
    ["Estimated cash", field(rating, ["estimated_cash"]), formatMaybeMoney],
    ["Cash burn", field(rating, ["cash_burn"]), formatMaybeMoney],
    ["Cash remaining months", field(rating, ["cash_remaining_months"]), (value: unknown) => Number(value).toFixed(1)],
  ]
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([label, value, formatter]) => `- ${label}: ${(formatter as (value: unknown) => string)(value)}`);

  const coverage = [
    floatData.length ? `- Float/outstanding records: ${floatData.length}` : null,
    registrations.length ? `- Active/recent registrations: ${registrations.length}` : null,
    compliance.length ? `- Nasdaq compliance records: ${compliance.length}` : null,
  ].filter(Boolean);

  return `AskEdgar Risk Snapshot: ${ticker}

Risk ratings
${riskLines.length ? riskLines.join("\n") : "- No rating fields returned."}

Cash / share metrics
${metricLines.length ? metricLines.join("\n") : "- No cash or share metrics returned."}

Coverage details
${coverage.length ? coverage.join("\n") : "- No optional registration/compliance/float records returned."}

How to use this
- High offering ability plus high cash need can point to future raise risk.
- Cash runway and Nasdaq compliance issues are worth checking against the latest 10-Q/8-K.
- Treat this as structured due diligence, not a trade signal.

Not financial advice. You are responsible for your own trades.`;
}

function summarizeRegistrations(registrations: JsonObject[], ticker: string): string {
  if (!registrations.length) return `AskEdgar Shelf / Registration Snapshot: ${ticker}\n\nNo shelf, ATM, or registration records returned for this ticker.`;
  const lines = registrations.slice(0, 5).map((registration, index) => {
    const form = field(registration, ["form_type", "form", "registration_type"]) || "Registration";
    return `${index + 1}. ${form}
- Status: ${formatRiskValue(field(registration, ["effective_status", "status", "is_effective"]))}
- ATM: ${formatRiskValue(field(registration, ["is_atm", "atm"]))}
- Offering amount: ${formatMaybeMoney(field(registration, ["offering_amount", "total_offering_amount"]))}
- Remaining: ${formatMaybeMoney(field(registration, ["amount_remaining_atm", "amount_remaining", "remaining_amount"]))}
- Filed / effective / expires: ${formatRiskValue(field(registration, ["filing_date", "filed_date"]))} / ${formatRiskValue(field(registration, ["effective_date"]))} / ${formatRiskValue(field(registration, ["expiration_date"]))}
- Baby shelf flag: ${formatRiskValue(field(registration, ["over_baby_shelf", "baby_shelf"]))}`;
  });
  return `AskEdgar Shelf / Registration Snapshot: ${ticker}\n\n${lines.join("\n\n")}\n\nShelf/ATM capacity can create future dilution risk. Not financial advice.`;
}

function summarizeFloat(floatData: JsonObject[], ticker: string): string {
  if (!floatData.length) return `AskEdgar Float / Outstanding Snapshot: ${ticker}\n\nNo float/outstanding records returned for this ticker.`;
  const latest = floatData[0];
  return `AskEdgar Float / Outstanding Snapshot: ${ticker}

- Float: ${formatNumber(field(latest, ["float", "public_float", "float_shares"]))}
- Shares outstanding: ${formatNumber(field(latest, ["outstanding", "shares_outstanding", "weighted_shares"]))}
- Market cap: ${formatMaybeMoney(field(latest, ["market_cap_final", "market_cap"]))}
- Insider ownership: ${formatPercent(field(latest, ["insider_ownership_pct", "insider_percent"]))}
- Institutional ownership: ${formatPercent(field(latest, ["institutional_ownership_pct", "institutional_percent"]))}
- Report date: ${formatRiskValue(field(latest, ["date", "reported_date", "filing_date"]))}

Low float can increase volatility. Not financial advice.`;
}

function summarizeCompliance(compliance: JsonObject[], ticker: string): string {
  if (!compliance.length) return `AskEdgar Nasdaq Compliance Snapshot: ${ticker}\n\nNo active Nasdaq compliance records returned for this ticker.`;
  const lines = compliance.slice(0, 5).map((record, index) => `${index + 1}. ${formatRiskValue(field(record, ["status", "compliance_status"]) || "record found")}
- Issue: ${formatRiskValue(field(record, ["deficiency", "deficiency_type", "issue"]))}
- Notice date: ${formatRiskValue(field(record, ["date", "filing_date", "notice_date"]))}
- Deadline: ${formatRiskValue(field(record, ["deadline", "compliance_deadline", "regain_compliance_date"]))}`);
  return `AskEdgar Nasdaq Compliance Snapshot: ${ticker}\n\n${lines.join("\n\n")}\n\nCompliance pressure can raise reverse split or financing risk. Not financial advice.`;
}

async function handleAskEdgarRequest(message: string): Promise<PedroAnswer | null> {
  const tickers = tickersFor(message, /\b(askedgar|risk|dilution|offering risk|shelf|shelves|atm|registration|registrations|float|outstanding|shares outstanding|nasdaq compliance|compliance|reg sho|regsho|cash runway)\b/i);
  if (!tickers.length) return null;
  if (!process.env.ASKEDGAR_API_KEY) {
    return { intent: "askedgar", text: "I can pull AskEdgar risk data once my AskEdgar API key is installed." };
  }

  const ticker = tickers[0];
  const intent = askEdgarIntent(message);
  if (intent === "registrations") return { intent: "askedgar", text: summarizeRegistrations(await fetchAskEdgarEndpoint("/v1/registrations", ticker), ticker) };
  if (intent === "float") return { intent: "askedgar", text: summarizeFloat(await fetchAskEdgarEndpoint("/v1/float-outstanding", ticker), ticker) };
  if (intent === "compliance") return { intent: "askedgar", text: summarizeCompliance(await fetchAskEdgarEndpoint("/v1/nasdaq-compliance", ticker), ticker) };

  const [ratingRows, registrations, compliance, floatData] = await Promise.all([
    fetchAskEdgarEndpoint("/v1/dilution-rating", ticker),
    fetchAskEdgarEndpoint("/v1/registrations", ticker).catch(() => []),
    fetchAskEdgarEndpoint("/v1/nasdaq-compliance", ticker).catch(() => []),
    fetchAskEdgarEndpoint("/v1/float-outstanding", ticker).catch(() => []),
  ]);
  return { intent: "askedgar", text: summarizeRisk(ratingRows[0] || null, registrations, compliance, floatData, ticker) };
}

function compactJson(value: unknown, maxLength = 16000): string {
  const text = JSON.stringify(value, null, 2);
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}\n...truncated...`;
}

async function askOpenAI(input: string, instructions = SYSTEM_PROMPT): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const response = await fetch(OPENAI_CHAT_URL, {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.PEDRO_OPENAI_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: input },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenAI request failed: ${response.status} ${body.slice(0, 200)}`);
  }

  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content?.trim() || null;
}

async function askAnthropic(input: string, instructions = SYSTEM_PROMPT): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  const response = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    cache: "no-store",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.PEDRO_ANTHROPIC_MODEL || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: instructions,
      messages: [{ role: "user", content: input }],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Anthropic request failed: ${response.status} ${body.slice(0, 200)}`);
  }

  const data = await response.json() as { content?: Array<{ type?: string; text?: string }> };
  return data.content?.find((block) => block.type === "text")?.text?.trim() || null;
}

function hasPedroAiProvider(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);
}

async function askPedroAi(input: string, instructions = SYSTEM_PROMPT): Promise<string | null> {
  const providers = [
    { name: "Anthropic", configured: Boolean(process.env.ANTHROPIC_API_KEY), ask: askAnthropic },
    { name: "OpenAI", configured: Boolean(process.env.OPENAI_API_KEY), ask: askOpenAI },
  ];
  const failures: string[] = [];

  for (const provider of providers) {
    if (!provider.configured) continue;
    try {
      const text = await provider.ask(input, instructions);
      if (text) return text;
      failures.push(`${provider.name}: empty response`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${provider.name}: ${message}`);
      console.warn(`[pedro] ${provider.name} provider failed; trying fallback`, message);
    }
  }

  if (failures.length) {
    throw new Error(`Pedro AI providers failed: ${failures.join(" | ")}`);
  }
  return null;
}

function stripFilingText(raw = ""): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#160;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function lookupCompanyByTicker(ticker: string): Promise<{ cik: string; ticker: string; title: string } | null> {
  secTickerCache ||= secFetchJson("https://www.sec.gov/files/company_tickers.json").then((companies) => Object.values(companies as Record<string, { cik_str: number; ticker: string; title: string }>));
  const companies = await secTickerCache;
  const company = companies.find((entry) => entry.ticker.toUpperCase() === ticker.toUpperCase());
  if (!company) return null;
  return {
    cik: String(company.cik_str).padStart(10, "0"),
    ticker: company.ticker,
    title: company.title,
  };
}

function filingDocumentUrl(cik: string, filing: { accessionNumber: string; primaryDocument: string }): string {
  const cikNumber = String(Number(cik));
  const accession = filing.accessionNumber.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cikNumber}/${accession}/${filing.primaryDocument}`;
}

function recentFilingsFromSubmissions(submissions: unknown): Array<{ form: string; filingDate: string; accessionNumber: string; primaryDocument: string }> {
  const recent = (submissions as JsonObject)?.filings && typeof (submissions as JsonObject).filings === "object"
    ? ((submissions as JsonObject).filings as JsonObject).recent as JsonObject
    : {};
  const forms = Array.isArray(recent?.form) ? recent.form : [];
  return forms.map((form, index) => ({
    form: String(form),
    filingDate: String((recent.filingDate as unknown[] | undefined)?.[index] || ""),
    accessionNumber: String((recent.accessionNumber as unknown[] | undefined)?.[index] || ""),
    primaryDocument: String((recent.primaryDocument as unknown[] | undefined)?.[index] || ""),
  }));
}

function pickFilingsToInspect(filings: Array<{ form: string; filingDate: string; accessionNumber: string; primaryDocument: string }>) {
  const interestingForms = ["10-Q", "10-K", "8-K", "S-1", "S-3", "S-4", "DEF 14A", "424B"];
  return filings
    .filter((filing) => interestingForms.some((form) => filing.form?.toUpperCase().startsWith(form)))
    .slice(0, 3);
}

async function summarizeFilings(ticker: string, company: { cik: string; title: string }, filings: ReturnType<typeof pickFilingsToInspect>): Promise<string> {
  if (!hasPedroAiProvider()) return "I can summarize filings once an AI provider key is installed.";
  const filingTexts = [];
  for (const filing of filings.slice(0, 2)) {
    const url = filingDocumentUrl(company.cik, filing);
    const raw = await secFetchText(url);
    filingTexts.push({
      ...filing,
      url,
      text: stripFilingText(raw).slice(0, 24000),
    });
  }

  return await askPedroAi(
    `Ticker: ${ticker}
Company: ${company.title}
CIK: ${company.cik}

Filing text:
${compactJson(filingTexts, 36000)}`,
    `${SYSTEM_PROMPT}

You are summarizing SEC filings. Focus on actionable due-diligence observations, not trade recommendations.
Use tight bullets. Include: forms reviewed, business/revenue notes, cash/debt/dilution notes if present, risk flags, and follow-up questions.
Keep the answer under 650 words. Finish with complete sentences. Include source URLs at the end.`,
  ) || "I found filings, but I could not summarize them cleanly.";
}

async function handleFilingRequest(message: string): Promise<PedroAnswer | null> {
  const tickers = tickersFor(message, /\b(filing|filings|edgar|sec|10-k|10-q|8-k)\b/i);
  if (!tickers.length) return null;
  const checked: string[] = [];

  for (const possibleTicker of tickers) {
    checked.push(possibleTicker);
    const company = await lookupCompanyByTicker(possibleTicker);
    if (!company) continue;
    const submissions = await secFetchJson(`https://data.sec.gov/submissions/CIK${company.cik}.json`);
    const filings = pickFilingsToInspect(recentFilingsFromSubmissions(submissions));
    if (!filings.length) {
      return { intent: "filings", text: `I found ${company.title} (${company.ticker}), but I did not find recent 10-K/10-Q/8-K/S-registration filings in the latest SEC feed.` };
    }
    return { intent: "filings", text: await summarizeFilings(possibleTicker, company, filings) };
  }

  return { intent: "filings", text: `I could not find a valid SEC ticker in that request. I checked: ${checked.join(", ")}. Try something like: filings BZFD.` };
}

async function collectResearchData(ticker: string): Promise<JsonObject> {
  const result: JsonObject = { ticker, askEdgar: {}, market: null, filings: null };

  if (process.env.ASKEDGAR_API_KEY) {
    const [rating, registrations, compliance, floatData] = await Promise.all([
      fetchAskEdgarEndpoint("/v1/dilution-rating", ticker).catch((error) => [{ error: error instanceof Error ? error.message : String(error) }]),
      fetchAskEdgarEndpoint("/v1/registrations", ticker).catch(() => []),
      fetchAskEdgarEndpoint("/v1/nasdaq-compliance", ticker).catch(() => []),
      fetchAskEdgarEndpoint("/v1/float-outstanding", ticker).catch(() => []),
    ]);
    result.askEdgar = { rating: rating[0] || null, registrations: registrations.slice(0, 5), compliance: compliance.slice(0, 5), floatOutstanding: floatData.slice(0, 3) };
  }

  if (process.env.POLYGON_API_KEY) {
    try {
      const [bars, snapshot] = await Promise.all([fetchDailyBars(ticker), fetchPolygonSnapshot(ticker)]);
      if (bars.length >= 2) result.market = buildMarketDataSummary({ ticker, bars, snapshot });
    } catch (error) {
      result.market = `Market data unavailable: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  try {
    const company = await lookupCompanyByTicker(ticker);
    if (company) {
      const submissions = await secFetchJson(`https://data.sec.gov/submissions/CIK${company.cik}.json`);
      const filings = pickFilingsToInspect(recentFilingsFromSubmissions(submissions)).slice(0, 2);
      const snippets = [];
      for (const filing of filings) {
        const url = filingDocumentUrl(company.cik, filing);
        const raw = await secFetchText(url);
        snippets.push({ form: filing.form, filingDate: filing.filingDate, url, text: stripFilingText(raw).slice(0, 9000) });
      }
      result.filings = { company, filings: snippets };
    }
  } catch (error) {
    result.filings = `SEC filings unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }

  return result;
}

async function handleResearchRequest(message: string): Promise<PedroAnswer | null> {
  const tickers = tickersFor(message, /\b(research|analyze|analysis|deep dive|brief|report|dd)\b/i);
  if (!tickers.length) return null;
  if (!hasPedroAiProvider()) {
    return { intent: "research", text: "I can build research briefs once an AI provider key is installed." };
  }

  const ticker = tickers[0];
  const researchData = await collectResearchData(ticker);
  const text = await askPedroAi(
    `Build an all-in-one research brief for ${ticker}.\n\nData:\n${compactJson(researchData, 42000)}`,
    `${SYSTEM_PROMPT}

You are preparing a premium small-cap research brief for Longboard members.
Use the provided AskEdgar, Polygon, and SEC data only. If a source is unavailable, say so briefly.
Be polished, specific, and structured. Do not recommend buying or selling.
Use this structure: Headline, Current tape, Executive read, Source snapshot, What matters now, Risk flags, Questions to verify before trading, Bottom line.
Keep the answer under 1,100 words.`,
  );
  return { intent: "research", text: text || "I gathered the research data, but I could not summarize it cleanly." };
}

async function handleGermanTranslationRequest(message: string, history: PedroChatMessage[]): Promise<PedroAnswer | null> {
  const command = parseGermanTranslationCommand(message);
  if (!command) return null;
  const previousUserMessage = [...history].reverse().find((item) => item.role === "user" && item.content.trim() && item.content.trim() !== message.trim());
  const textToTranslate = command.inlineText || previousUserMessage?.content.trim();
  if (!textToTranslate) {
    return { intent: "translation", text: "Send /german <text>, or ask after a message you want translated." };
  }
  if (!hasPedroAiProvider()) {
    return { intent: "translation", text: "I can translate messages once an AI provider key is installed." };
  }
  const text = await askPedroAi(
    textToTranslate,
    `Translate the user's message into natural German.
Translate all human-readable prose, headings, labels, and bullet text.
Preserve identifiers and literal values: usernames, stock tickers, company names, SEC form names, dollar amounts, numbers, dates, URLs, emoji, and line breaks.
Do not add commentary, explanations, disclaimers, or notes.
If the message is already German, lightly polish only obvious mistakes.`,
  );
  return { intent: "translation", text: `German translation\n${text || "I could not translate that cleanly. Try a shorter section."}` };
}

async function askPedro(message: string): Promise<PedroAnswer> {
  if (!hasPedroAiProvider()) {
    return { intent: "general", text: "I am wired up, but an AI provider key is not installed yet." };
  }
  const text = await askPedroAi(message || "Say hello and introduce yourself briefly.");
  return { intent: "general", text: text || "I am here, but I came up empty on that one." };
}

export async function answerPedro({ message, history = [] }: { message: string; history?: PedroChatMessage[] }): Promise<PedroAnswer> {
  const cleaned = message.trim();
  if (!cleaned) {
    return { intent: "empty", text: "Ask me for a quote, filings, targets, AskEdgar risk, research, or normal market help." };
  }

  return (
    (await handleGermanTranslationRequest(cleaned, history)) ||
    (isHelpRequest(cleaned) ? { intent: "help", text: buildHelpResponse() } : null) ||
    (await handleScannerRequest(cleaned)) ||
    (await handleTargetRequest(cleaned)) ||
    (await handleResearchRequest(cleaned)) ||
    (await handleFilingRequest(cleaned)) ||
    (await handleAskEdgarRequest(cleaned)) ||
    (await handleMarketDataRequest(cleaned)) ||
    (await askPedro(cleaned))
  );
}
