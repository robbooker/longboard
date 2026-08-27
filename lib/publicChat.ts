export type PublicChatMessage = {
  id: string;
  guest_id: string;
  author_label: string;
  body: string;
  created_at: string;
  pending?: boolean;
};

export type PublicChatReaction = {
  message_id: string;
  guest_id: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

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

export function mergeMessage(list: PublicChatMessage[], incoming: PublicChatMessage) {
  const withoutExisting = list.filter((message) => message.id !== incoming.id);
  return [...withoutExisting, incoming]
    .sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime())
    .slice(-80);
}

export function mergeReaction(list: PublicChatReaction[], incoming: PublicChatReaction) {
  return [
    ...list.filter((reaction) => reaction.message_id !== incoming.message_id || reaction.guest_id !== incoming.guest_id),
    incoming,
  ].slice(-500);
}

export function reactionSummary(reactions: PublicChatReaction[], messageId: string, guestId: string) {
  const active = reactions.filter((reaction) => reaction.message_id === messageId && reaction.active);
  return {
    count: active.length,
    reacted: active.some((reaction) => reaction.guest_id === guestId),
  };
}

export function countChatters(presenceState: Record<string, unknown[]>) {
  return Object.keys(presenceState).length;
}

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
