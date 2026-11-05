export type ChatMessagePart =
  | { kind: "text"; value: string }
  | { kind: "link"; href: string; value: string };

export type TradingViewSnapshot = {
  chartId: string;
  href: string;
  imageUrl: string;
};

const TRADING_VIEW_HOSTS = new Set(["tradingview.com", "www.tradingview.com"]);

// D-366: a link is a full http(s) address, a www. address, or a bare domain like robbooker.com.
// Bare domains must end in a known web suffix so "e.g.", "3.5", "report.pdf", "node.js" and
// exchange tickers like "SHOP.TO" or "SAP.DE" stay plain text. www. addresses accept any suffix.
const BARE_TLDS = [
  "com", "net", "org", "edu", "gov", "mil", "int", "io", "co", "ai", "app", "dev", "me", "info", "biz",
  "tv", "xyz", "gg", "ly", "fm", "news", "site", "online", "tech", "blog", "link", "page", "cloud", "store",
  "shop", "finance", "money", "markets", "market", "trade", "trading", "capital", "fund", "club", "live",
  "video", "media", "email", "social", "group", "pro", "inc", "company", "website", "space", "world",
  "today", "academy", "school", "us", "uk", "ca", "au", "nz", "ie", "eu", "ch", "nl", "se", "fr", "es", "jp",
];
const LABEL = String.raw`[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?`;
const REST = String.raw`[^\s<>"'()[\]{}]`;
const PATH = String.raw`(?::\d{1,5})?(?:[/?#]${REST}*)?`;
const URL_PATTERN = new RegExp(
  [
    String.raw`(https?:\/\/${REST}+)`,
    String.raw`(?:www\.(?:${LABEL}\.)+[a-z]{2,24}(?![\w-])${PATH})`,
    String.raw`(?:(?:${LABEL}\.)+(?:${BARE_TLDS.join("|")})(?![\w-])${PATH})`,
  ].join("|"),
  "gi",
);
// A www. or bare address right after one of these is part of an email, a path or a longer word.
const JOINED_BEFORE = /[\w@./:\\-]/;

export function tokenizeChatMessage(body: string): ChatMessagePart[] {
  const parts: ChatMessagePart[] = [];
  let cursor = 0;

  for (const match of body.matchAll(URL_PATTERN)) {
    const index = match.index ?? 0;
    const scheme = match[1] !== undefined;
    if (!scheme && index > 0 && JOINED_BEFORE.test(body[index - 1])) continue;
    if (index > cursor) parts.push({ kind: "text", value: body.slice(cursor, index) });

    const value = match[0].replace(/[.,!?;:]+$/g, "");
    if (value) parts.push({ kind: "link", href: scheme ? value : `https://${value}`, value });

    const trailing = match[0].slice(value.length);
    if (trailing) parts.push({ kind: "text", value: trailing });
    cursor = index + match[0].length;
  }

  if (cursor < body.length) parts.push({ kind: "text", value: body.slice(cursor) });
  return parts.length ? parts : [{ kind: "text", value: body }];
}

export function tradingViewSnapshotFromText(body: string): TradingViewSnapshot | null {
  for (const part of tokenizeChatMessage(body)) {
    if (part.kind !== "link") continue;

    let url: URL;
    try {
      url = new URL(part.href);
    } catch {
      continue;
    }

    if (url.protocol !== "https:" || !TRADING_VIEW_HOSTS.has(url.hostname.toLowerCase())) continue;

    const match = url.pathname.match(/^\/x\/([A-Za-z0-9]{8})\/?$/);
    if (!match || url.search || url.hash) continue;

    const chartId = match[1];
    return {
      chartId,
      href: `https://www.tradingview.com/x/${chartId}/`,
      imageUrl: `https://s3.tradingview.com/snapshots/${chartId[0].toLowerCase()}/${chartId}.png`,
    };
  }

  return null;
}
