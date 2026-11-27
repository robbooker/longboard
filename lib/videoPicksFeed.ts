// #529 Booker Tube: reading a YouTube channel's public feed and scoring its videos against a
// collection's topics. Plain functions only (no network, no database), so the refresh job, the
// routes and the tests all use the same rules.
//
// The rules: public videos only, no Shorts, nothing older than the collection's window (90 days),
// and anything that sells signals, pumps tickers or promises returns is pushed down or out by the
// collection's penalty phrases.

export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
export const DEFAULT_WINDOW_DAYS = 90;
/** A feed that carries a length at or under this many seconds is a Short. */
export const SHORTS_MAX_SECONDS = 61;
const DAY_MS = 86_400_000;

export type FeedEntry = {
  id: string;
  title: string;
  channelId: string;
  authorName: string;
  published: string;
  link: string;
  description: string;
  durationSeconds: number | null;
};

export type PicksScoring = {
  titleMultiplier: number;
  descriptionMultiplier: number;
  channelTopicPrior: number;
  recencyHalfLifeDays: number;
  recencyMaxBonus: number;
  minScoreToInclude: number;
};
export const DEFAULT_SCORING: PicksScoring = {
  titleMultiplier: 2.4,
  descriptionMultiplier: 1,
  channelTopicPrior: 3.5,
  recencyHalfLifeDays: 30,
  recencyMaxBonus: 3,
  minScoreToInclude: 1,
};

export type PicksArea = { id: string; label: string; tagline: string };
export type PicksKeyword = { phrase: string; weight: number };
export type PicksTopic = { id: string; area: string; label: string; weight: number; keywords: PicksKeyword[] };
export type PicksPenalty = { phrase: string; penalty: number };
export type PicksChannel = { channelId: string; name: string; area: string; topics: string[] };
export type PicksConfig = { scoring: PicksScoring; topics: PicksTopic[]; penalties: PicksPenalty[] };

/** One video as it is stored and sent to the page. */
export type PicksVideo = {
  id: string;
  title: string;
  channel: string;
  channelId: string;
  area: string;
  published: string;
  snippet: string;
  topics: string[];
  primaryTopic: string | null;
  score: number;
};

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/**
 * XML text to plain text, in ONE pass: "&amp;lt;" is the text "&lt;", never "<". A number that is
 * not a real character is dropped instead of throwing.
 */
export function decodeXmlEntities(value: string) {
  return String(value ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>|&(?:#x([0-9a-fA-F]{1,6})|#(\d{1,7})|(amp|lt|gt|quot|apos));/g, (match, cdata, hex, dec, name) => {
      if (cdata !== undefined) return cdata;
      if (name) return NAMED_ENTITIES[name];
      const code = hex ? Number.parseInt(hex, 16) : Number.parseInt(dec, 10);
      if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "";
      return String.fromCodePoint(code);
    });
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function tagText(block: string, tag: string) {
  const name = escapeRegex(tag);
  const found = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
  return found ? decodeXmlEntities(found[1]).trim() : "";
}

function tagAttribute(block: string, tag: string, attribute: string) {
  const tags = new RegExp(`<${escapeRegex(tag)}\\b([^>]*?)\\/?>`, "gi");
  const wanted = new RegExp(`\\b${escapeRegex(attribute)}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
  for (const found of block.matchAll(tags)) {
    const value = found[1].match(wanted);
    if (value) return decodeXmlEntities(value[1] ?? value[2] ?? "").trim();
  }
  return "";
}

function alternateLink(entry: string) {
  let fallback = "";
  for (const found of entry.matchAll(/<link\b([^>]*?)\/?\s*>/gi)) {
    const href = found[1].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const address = href ? decodeXmlEntities(href[1] ?? href[2] ?? "") : "";
    if (!address) continue;
    if (/\brel\s*=\s*(?:"alternate"|'alternate')/i.test(found[1])) return address;
    fallback ||= address;
  }
  return fallback;
}

/** The channel's own name, from the top of its feed (before the first video). */
export function feedChannelName(xml: string) {
  if (typeof xml !== "string") return "";
  const first = xml.search(/<entry\b/i);
  const head = first < 0 ? xml : xml.slice(0, first);
  const author = head.match(/<author\b[^>]*>([\s\S]*?)<\/author>/i)?.[1] ?? "";
  return (tagText(head.replace(/<author\b[\s\S]*?<\/author>/gi, ""), "title") || tagText(author, "name")).slice(0, 120);
}

/** True when the text is an Atom feed at all (YouTube answers a missing channel with a web page). */
export const looksLikeFeed = (xml: string) => typeof xml === "string" && /<feed[\s>]/i.test(xml);

/** The videos in a channel feed. Entries without a real video id or a title are left out. */
export function parseAtomFeed(xml: string): FeedEntry[] {
  if (typeof xml !== "string" || !xml) return [];
  const entries: FeedEntry[] = [];
  for (const found of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)) {
    const block = found[1];
    const id = tagText(block, "yt:videoId") || tagText(block, "id").replace(/^yt:video:/i, "");
    const title = tagText(block, "title");
    if (!VIDEO_ID.test(id) || !title) continue;
    const author = block.match(/<author\b[^>]*>([\s\S]*?)<\/author>/i)?.[1] ?? "";
    const seconds = tagAttribute(block, "yt:duration", "seconds") || tagAttribute(block, "media:content", "duration");
    entries.push({
      id,
      title,
      channelId: tagText(block, "yt:channelId"),
      authorName: tagText(author, "name"),
      published: tagText(block, "published") || tagText(block, "updated"),
      link: alternateLink(block) || `https://www.youtube.com/watch?v=${id}`,
      description: tagText(block, "media:description"),
      durationSeconds: /^\d+$/.test(seconds) ? Number.parseInt(seconds, 10) : null,
    });
  }
  return entries;
}

/**
 * Is this a Short? Three signals a feed can carry: a /shorts/ address, a length of a minute or
 * less, or an explicit Shorts tag (#shorts, #ytshorts, #youtubeshorts, "[Shorts]").
 *
 * The trading words must never count: "shorting", "short seller", "short squeeze", "short-term",
 * and a lone "#short" or "(Short)" (which traders use for a short sale).
 */
export function isShortVideo(entry: Pick<FeedEntry, "link" | "title" | "description" | "durationSeconds">): { isShort: boolean; reason: string | null } {
  if (/youtube\.com\/shorts\//i.test(entry.link ?? "")) return { isShort: true, reason: "shorts-url" };
  const seconds = entry.durationSeconds;
  if (typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 && seconds <= SHORTS_MAX_SECONDS)
    return { isShort: true, reason: "duration" };
  const hashtag = /(?:^|[^A-Za-z0-9_#])#(?:yt|youtube)?shorts(?![A-Za-z0-9_])/i;
  if (hashtag.test(entry.title ?? "") || hashtag.test(entry.description ?? "")) return { isShort: true, reason: "shorts-hashtag" };
  if (/[[(]\s*(?:yt\s+|youtube\s+)?shorts\s*[\])]/i.test(entry.title ?? "")) return { isShort: true, reason: "shorts-title-tag" };
  return { isShort: false, reason: null };
}

/** Published inside the window (a day of clock difference into the future is allowed). */
export function isWithinWindow(published: string, nowMs: number, windowDays = DEFAULT_WINDOW_DAYS) {
  const at = Date.parse(published);
  if (!Number.isFinite(at)) return false;
  return nowMs - at <= windowDays * DAY_MS && at - nowMs <= DAY_MS;
}

/** A readable line or two of the description: no bare links, chapter lists or "subscribe" lines. */
export function cleanSnippet(description: string, maxLength = 220) {
  if (!description) return "";
  const lines = String(description)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !/^https?:\/\/\S+$/i.test(line) &&
        !/^\d{1,2}:\d{2}(?::\d{2})?\s+/.test(line) &&
        !/^(?:subscribe|follow me|sponsor|patreon|merch|links?:)/i.test(line),
    );
  const text = lines
    .join(" ")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > maxLength * 0.6 ? cut.slice(0, space) : cut).replace(/[,;:\-–—\s]+$/, "")}…`;
}

/** A phrase on its own: "halt" is not found in "halts", and "three.js" or "8-bit" match cleanly. */
function phraseFinder() {
  const made = new Map<string, RegExp>();
  return (text: string, phrase: string) => {
    if (!text || !phrase) return false;
    let finder = made.get(phrase);
    if (!finder) made.set(phrase, (finder = new RegExp(`(?<![a-z0-9])${escapeRegex(phrase)}(?![a-z0-9])`)));
    return finder.test(text);
  };
}

const finite = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
const round2 = (value: number) => Math.round(value * 100) / 100;

export type VideoScore = {
  score: number;
  area: string;
  primaryTopic: string | null;
  topics: string[];
  penalty: number;
};

/**
 * How well a video fits a collection.
 *  - Each topic: its phrases found in the title (x titleMultiplier) or else the description, plus a
 *    head start when the channel is listed under that topic, all times the topic's weight.
 *  - The best topic counts in full and the next two for a quarter each.
 *  - Newer videos get up to recencyMaxBonus, halving every recencyHalfLifeDays.
 *  - Each penalty phrase takes its points off (half if it is only in the description).
 */
export function scoreVideo(entry: Pick<FeedEntry, "title" | "description" | "published">, channel: Pick<PicksChannel, "area" | "topics">, config: PicksConfig, nowMs: number): VideoScore {
  const scoring = { ...DEFAULT_SCORING, ...config.scoring };
  const found = phraseFinder();
  const title = String(entry.title ?? "").toLowerCase();
  const description = String(entry.description ?? "").toLowerCase();
  const channelTopics = new Set(channel.topics ?? []);

  const matched: Array<{ id: string; area: string; score: number; hits: number }> = [];
  for (const topic of config.topics) {
    let raw = 0;
    let hits = 0;
    for (const keyword of topic.keywords ?? []) {
      const phrase = String(keyword.phrase ?? "").toLowerCase();
      if (!phrase) continue;
      const weight = finite(keyword.weight, 1);
      if (found(title, phrase)) {
        raw += weight * scoring.titleMultiplier;
        hits += 1;
      } else if (found(description, phrase)) {
        raw += weight * scoring.descriptionMultiplier;
        hits += 1;
      }
    }
    if (channelTopics.has(topic.id)) raw += scoring.channelTopicPrior;
    if (raw > 0) matched.push({ id: topic.id, area: topic.area, score: round2(raw * finite(topic.weight, 1)), hits });
  }
  matched.sort((a, b) => b.score - a.score || b.hits - a.hits);

  let penalty = 0;
  for (const item of config.penalties) {
    const phrase = String(item.phrase ?? "").toLowerCase();
    const points = finite(item.penalty, 2);
    if (found(title, phrase)) penalty += points;
    else if (found(description, phrase)) penalty += points * 0.5;
  }

  const at = Date.parse(entry.published);
  const ageDays = Number.isFinite(at) ? Math.max(0, (nowMs - at) / DAY_MS) : Infinity;
  const recency = Number.isFinite(ageDays) ? scoring.recencyMaxBonus * Math.pow(0.5, ageDays / Math.max(1, scoring.recencyHalfLifeDays)) : 0;

  const top = matched.slice(0, 3);
  const primary = top[0] ?? null;
  const secondary = top.slice(1).reduce((sum, topic) => sum + topic.score * 0.25, 0);
  return {
    score: Math.max(0, round2((primary?.score ?? 0) + secondary + recency - penalty)),
    area: primary?.area ?? channel.area,
    primaryTopic: primary?.id ?? null,
    topics: top.map((topic) => topic.id),
    penalty: round2(penalty),
  };
}

export type FeedTally = { parsed: number; old: number; shorts: number; lowScore: number };

/**
 * The videos of one channel feed that belong in the collection, with what was left out and why.
 * Videos credited to another channel are skipped: a feed only speaks for its own channel.
 */
export function videosFromFeed(xml: string, channel: PicksChannel, config: PicksConfig, nowMs: number, windowDays = DEFAULT_WINDOW_DAYS): { videos: PicksVideo[]; tally: FeedTally } {
  const tally: FeedTally = { parsed: 0, old: 0, shorts: 0, lowScore: 0 };
  const videos: PicksVideo[] = [];
  const minScore = finite(config.scoring?.minScoreToInclude, DEFAULT_SCORING.minScoreToInclude);
  for (const entry of parseAtomFeed(xml)) {
    if (entry.channelId && entry.channelId !== channel.channelId) continue;
    tally.parsed += 1;
    if (!isWithinWindow(entry.published, nowMs, windowDays)) {
      tally.old += 1;
      continue;
    }
    if (isShortVideo(entry).isShort) {
      tally.shorts += 1;
      continue;
    }
    const scored = scoreVideo(entry, channel, config, nowMs);
    if (scored.score < minScore) {
      tally.lowScore += 1;
      continue;
    }
    videos.push({
      id: entry.id,
      title: entry.title.slice(0, 300),
      channel: channel.name,
      channelId: channel.channelId,
      area: scored.area,
      published: new Date(Date.parse(entry.published)).toISOString(),
      snippet: cleanSnippet(entry.description),
      topics: scored.topics,
      primaryTopic: scored.primaryTopic,
      score: scored.score,
    });
  }
  return { videos, tally };
}

/** Best match first, then newest; a video listed twice keeps its better score. */
export function mergeVideos(lists: PicksVideo[][]): PicksVideo[] {
  const byId = new Map<string, PicksVideo>();
  for (const video of lists.flat()) {
    const have = byId.get(video.id);
    if (!have || video.score > have.score) byId.set(video.id, video);
  }
  return [...byId.values()].sort((a, b) => b.score - a.score || Date.parse(b.published) - Date.parse(a.published));
}

export type ChannelRef = { kind: "id"; channelId: string } | { kind: "handle"; handle: string };

/**
 * What an admin typed for a channel: its UC… id, a youtube.com/channel/UC… address, or an @handle
 * (alone or as a youtube.com/@handle address). Anything else is null.
 */
export function parseChannelRef(value: unknown): ChannelRef | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > 200) return null;
  if (CHANNEL_ID.test(text)) return { kind: "id", channelId: text };
  const handle = (name: string): ChannelRef | null => (/^[A-Za-z0-9._-]{3,30}$/.test(name) ? { kind: "handle", handle: name } : null);
  if (text.startsWith("@")) return handle(text.slice(1));
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname.toLowerCase())) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "channel" && CHANNEL_ID.test(parts[1] ?? "")) return { kind: "id", channelId: parts[1] };
  if (parts[0]?.startsWith("@")) return handle(decodeURIComponent(parts[0]).slice(1));
  return null;
}

/** The UC… id a channel's public page names as its own (its canonical address), or null. */
export function channelIdFromPage(html: string) {
  if (typeof html !== "string") return null;
  const canonical =
    html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})["']/i) ??
    html.match(/<link[^>]+href=["']https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})["'][^>]+rel=["']canonical["']/i) ??
    html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})["']/i);
  return canonical ? canonical[1] : null;
}

export const feedUrl = (channelId: string) => `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
export const thumbnailUrl = (videoId: string) => `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
export const watchUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;
