export type ChatMessagePart =
  | { kind: "text"; value: string }
  | { kind: "link"; href: string; value: string };

export type TradingViewSnapshot = {
  chartId: string;
  href: string;
  imageUrl: string;
};

const URL_PATTERN = /https?:\/\/[^\s<>"'()[\]{}]+/gi;
const TRADING_VIEW_HOSTS = new Set(["tradingview.com", "www.tradingview.com"]);

export function tokenizeChatMessage(body: string): ChatMessagePart[] {
  const parts: ChatMessagePart[] = [];
  let cursor = 0;

  for (const match of body.matchAll(URL_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ kind: "text", value: body.slice(cursor, index) });

    const href = match[0].replace(/[.,!?;:]+$/g, "");
    if (href) parts.push({ kind: "link", href, value: href });

    const trailing = match[0].slice(href.length);
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
