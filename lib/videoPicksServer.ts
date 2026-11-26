import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CHANNEL_ID,
  DEFAULT_SCORING,
  DEFAULT_WINDOW_DAYS,
  channelIdFromPage,
  feedChannelName,
  feedUrl,
  isWithinWindow,
  looksLikeFeed,
  mergeVideos,
  videosFromFeed,
  type ChannelRef,
  type PicksArea,
  type PicksChannel,
  type PicksConfig,
  type PicksPenalty,
  type PicksTopic,
  type PicksVideo,
} from "@/lib/videoPicksFeed";

// #529 Booker Tube, server side: the collection's rows, the daily refresh from the channels'
// public feeds, and the answer the page reads. Only the service role touches the tables, and only
// from routes that have checked the member (or the cron secret) first.
//
// A "collection" is one person's list. Today there is one, Rob's, shared with every member; every
// function here takes the collection's slug, so a member's own collection later uses the same code.

export const VIDEO_PICKS_SLUG = "booker-tube";
export const VIDEO_PICKS_PAGE = { slug: VIDEO_PICKS_SLUG, kind: "video-picks", position: 40 } as const;
/** How many channels one collection may read (keeps a refresh well inside its time limit). */
export const MAX_CHANNELS = 80;
export const MAX_CHANNEL_TOPICS = 3;

/** A plain reader's name: says what it is, and nothing about who runs it. */
export const FEED_USER_AGENT = "Mozilla/5.0 (compatible; feed-reader/1.0)";
const FEED_ACCEPT = "application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1";
const FEED_TIMEOUT_MS = 8_000;
const FEED_PAUSE_MS = 250;
const FEED_MAX_BYTES = 2_000_000;
/** A refresh stops asking for feeds after this long; channels not reached keep their last videos. */
const REFRESH_BUDGET_MS = 240_000;

type Db = SupabaseClient;
type Fetch = typeof fetch;

export type PicksCollection = {
  id: string;
  slug: string;
  title: string;
  shared: boolean;
  windowDays: number;
  config: Omit<PicksConfig, "topics">;
  areas: PicksArea[];
  refreshedAt: string | null;
  refreshStats: RefreshStats | null;
};
export type StoredChannel = PicksChannel & { note: string | null };
export type RefreshStats = {
  channels: number;
  succeeded: number;
  failed: Array<{ channelId: string; name: string; error: string }>;
  parsed: number;
  old: number;
  shorts: number;
  lowScore: number;
  carried: number;
  videos: number;
  tookMs: number;
};
export type RefreshOutcome = { stored: boolean; reason: "stored" | "no_channels" | "most_feeds_failed" | "nothing_found"; stats: RefreshStats };

const text = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const number = (value: unknown, fallback: number) => {
  const parsed = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : fallback;
};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

export async function readCollection(db: Db, slug: string): Promise<PicksCollection | null> {
  const { data, error } = await db
    .from("chat_video_collections")
    .select("id, slug, title, owner_member_id, visibility, window_days, scoring, areas, penalties, refreshed_at, refresh_stats")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error("video_collection_unavailable");
  if (!data) return null;
  const row = data as Record<string, unknown>;
  const scoring = record(row.scoring);
  return {
    id: text(row.id),
    slug: text(row.slug),
    title: text(row.title),
    shared: row.owner_member_id === null && row.visibility === "members",
    windowDays: number(row.window_days, DEFAULT_WINDOW_DAYS),
    config: {
      scoring: {
        titleMultiplier: number(scoring.titleMultiplier, DEFAULT_SCORING.titleMultiplier),
        descriptionMultiplier: number(scoring.descriptionMultiplier, DEFAULT_SCORING.descriptionMultiplier),
        channelTopicPrior: number(scoring.channelTopicPrior, DEFAULT_SCORING.channelTopicPrior),
        recencyHalfLifeDays: number(scoring.recencyHalfLifeDays, DEFAULT_SCORING.recencyHalfLifeDays),
        recencyMaxBonus: number(scoring.recencyMaxBonus, DEFAULT_SCORING.recencyMaxBonus),
        minScoreToInclude: number(scoring.minScoreToInclude, DEFAULT_SCORING.minScoreToInclude),
      },
      penalties: list(row.penalties)
        .map(record)
        .map((item): PicksPenalty => ({ phrase: text(item.phrase), penalty: number(item.penalty, 2) }))
        .filter((item) => item.phrase),
    },
    areas: list(row.areas)
      .map(record)
      .map((item): PicksArea => ({ id: text(item.id), label: text(item.label), tagline: text(item.tagline) }))
      .filter((item) => item.id && item.label),
    refreshedAt: typeof row.refreshed_at === "string" ? new Date(row.refreshed_at).toISOString() : null,
    refreshStats: row.refresh_stats && typeof row.refresh_stats === "object" ? (row.refresh_stats as RefreshStats) : null,
  };
}

export async function readTopics(db: Db, collectionId: string): Promise<PicksTopic[]> {
  const { data, error } = await db
    .from("chat_video_topics")
    .select("topic_id, area, label, weight, keywords, position")
    .eq("collection_id", collectionId)
    .order("position", { ascending: true })
    .order("topic_id", { ascending: true });
  if (error) throw new Error("video_topics_unavailable");
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: text(row.topic_id),
    area: text(row.area),
    label: text(row.label),
    weight: number(row.weight, 1),
    keywords: list(row.keywords)
      .map(record)
      .map((item) => ({ phrase: text(item.phrase), weight: number(item.weight, 1) }))
      .filter((item) => item.phrase),
  }));
}

export async function readChannels(db: Db, collectionId: string): Promise<StoredChannel[]> {
  const { data, error } = await db
    .from("chat_video_channels")
    .select("channel_id, name, area, topics, note, position")
    .eq("collection_id", collectionId)
    .order("position", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error("video_channels_unavailable");
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    channelId: text(row.channel_id),
    name: text(row.name),
    area: text(row.area),
    topics: list(row.topics).filter((topic): topic is string => typeof topic === "string"),
    note: typeof row.note === "string" ? row.note : null,
  }));
}

export async function readVideos(db: Db, collectionId: string): Promise<PicksVideo[]> {
  const { data, error } = await db
    .from("chat_video_picks")
    .select("video_id, channel_id, channel_name, title, published_at, area, primary_topic, topics, snippet, score")
    .eq("collection_id", collectionId)
    .order("score", { ascending: false })
    .order("published_at", { ascending: false })
    .limit(2000);
  if (error) throw new Error("video_picks_unavailable");
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: text(row.video_id),
    title: text(row.title),
    channel: text(row.channel_name),
    channelId: text(row.channel_id),
    area: text(row.area),
    published: new Date(text(row.published_at)).toISOString(),
    snippet: text(row.snippet),
    topics: list(row.topics).filter((topic): topic is string => typeof topic === "string"),
    primaryTopic: typeof row.primary_topic === "string" ? row.primary_topic : null,
    score: number(row.score, 0),
  }));
}

export type FeedResult = { ok: true; xml: string } | { ok: false; error: string };

/**
 * One channel's public feed: one request, a time limit, a size limit, and never a throw. The
 * address is built here from a checked channel id; nothing a caller typed is fetched as given.
 */
export async function fetchChannelFeed(channelId: string, options: { fetchImpl?: Fetch; timeoutMs?: number } = {}): Promise<FeedResult> {
  if (!CHANNEL_ID.test(channelId)) return { ok: false, error: "not a channel id" };
  try {
    const response = await (options.fetchImpl ?? fetch)(feedUrl(channelId), {
      headers: { "User-Agent": FEED_USER_AGENT, Accept: FEED_ACCEPT },
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? FEED_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    if (Number(response.headers.get("content-length") ?? 0) > FEED_MAX_BYTES) return { ok: false, error: "feed too large" };
    const xml = await response.text();
    if (xml.length > FEED_MAX_BYTES) return { ok: false, error: "feed too large" };
    if (!looksLikeFeed(xml)) return { ok: false, error: "not a feed" };
    return { ok: true, xml };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return { ok: false, error: name === "TimeoutError" || name === "AbortError" ? "timed out" : "request failed" };
  }
}

export type RefreshOptions = {
  fetchImpl?: Fetch;
  now?: () => number;
  pauseMs?: number;
  timeoutMs?: number;
  budgetMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Reads every channel of a collection, one at a time with a short pause, and stores the new list.
 *  - One bad feed never fails the run: that channel keeps the videos it had (those still inside
 *    the window), and the rest are replaced.
 *  - If most feeds fail, or nothing at all comes back where there were videos before, nothing is
 *    stored: the page keeps the last good list.
 */
export async function refreshCollection(db: Db, slug: string, options: RefreshOptions = {}): Promise<RefreshOutcome | null> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const started = now();
  const collection = await readCollection(db, slug);
  if (!collection) return null;
  const [topics, channels, previous] = await Promise.all([readTopics(db, collection.id), readChannels(db, collection.id), readVideos(db, collection.id)]);
  const config: PicksConfig = { ...collection.config, topics };
  const stats: RefreshStats = { channels: channels.length, succeeded: 0, failed: [], parsed: 0, old: 0, shorts: 0, lowScore: 0, carried: 0, videos: 0, tookMs: 0 };
  const done = (stored: boolean, reason: RefreshOutcome["reason"]): RefreshOutcome => ({ stored, reason, stats: { ...stats, tookMs: now() - started } });
  if (!channels.length) return done(false, "no_channels");

  const lists: PicksVideo[][] = [];
  const failed = new Set<string>();
  for (const [index, channel] of channels.entries()) {
    let result: FeedResult;
    if (now() - started > (options.budgetMs ?? REFRESH_BUDGET_MS)) result = { ok: false, error: "not reached in time" };
    else {
      if (index > 0) await sleep(options.pauseMs ?? FEED_PAUSE_MS);
      result = await fetchChannelFeed(channel.channelId, options);
    }
    if (result.ok) {
      try {
        const { videos, tally } = videosFromFeed(result.xml, channel, config, now(), collection.windowDays);
        lists.push(videos);
        stats.succeeded += 1;
        stats.parsed += tally.parsed;
        stats.old += tally.old;
        stats.shorts += tally.shorts;
        stats.lowScore += tally.lowScore;
        continue;
      } catch {
        result = { ok: false, error: "feed could not be read" };
      }
    }
    failed.add(channel.channelId);
    stats.failed.push({ channelId: channel.channelId, name: channel.name, error: result.error });
  }

  if (stats.succeeded * 2 < channels.length) return done(false, "most_feeds_failed");
  const carried = previous.filter((video) => failed.has(video.channelId) && isWithinWindow(video.published, now(), collection.windowDays));
  stats.carried = carried.length;
  const videos = mergeVideos([...lists, carried]);
  stats.videos = videos.length;
  if (!videos.length && previous.length) return done(false, "nothing_found");

  const outcome = done(true, "stored");
  const { error } = await db.rpc("store_chat_video_refresh", { p_collection: collection.id, p_videos: videos, p_stats: outcome.stats });
  if (error) throw new Error("video_refresh_not_stored");
  forgetPicksAnswer(slug);
  // The page joins the sidebar once there is something on it (and never before this code is live).
  if (collection.shared && slug === VIDEO_PICKS_SLUG && videos.length) {
    const page = await db
      .from("chat_pages")
      .upsert({ ...VIDEO_PICKS_PAGE, name: collection.title.slice(0, 40), built_in: true }, { onConflict: "slug", ignoreDuplicates: true });
    if (page.error) throw new Error("video_page_not_added");
  }
  return outcome;
}

/** What the page reads. No phrases, weights or channel notes: only what a card and the filters show. */
export type PicksAnswer = {
  title: string;
  updatedAt: string | null;
  windowDays: number;
  areas: PicksArea[];
  topics: Array<{ id: string; area: string; label: string }>;
  videos: PicksVideo[];
};

const ANSWER_TTL_MS = 5 * 60_000;
const answers = new Map<string, { at: number; answer: PicksAnswer; etag: string }>();
export function forgetPicksAnswer(slug?: string) {
  if (slug) answers.delete(slug);
  else answers.clear();
}

/**
 * The collection as the page shows it. The list changes once a day, so each server instance
 * keeps its answer for five minutes; `fresh` (an admin who just changed something) reads again.
 */
export async function readPicksAnswer(db: Db, slug: string, options: { fresh?: boolean; now?: number } = {}) {
  const now = options.now ?? Date.now();
  const kept = answers.get(slug);
  if (kept && !options.fresh && now - kept.at < ANSWER_TTL_MS) return kept;
  const collection = await readCollection(db, slug);
  if (!collection) return null;
  const [topics, videos] = await Promise.all([readTopics(db, collection.id), readVideos(db, collection.id)]);
  const answer: PicksAnswer = {
    title: collection.title,
    updatedAt: collection.refreshedAt,
    windowDays: collection.windowDays,
    areas: collection.areas,
    topics: topics.map(({ id, area, label }) => ({ id, area, label })),
    videos,
  };
  const entry = { at: now, answer, etag: `"vp-${collection.refreshedAt ?? "0"}-${videos.length}-${topics.length}"` };
  answers.set(slug, entry);
  return entry;
}

export type ResolvedChannel = { ok: true; channelId: string; name: string } | { ok: false; error: string };

/**
 * Turns what an admin typed into a channel that really has a public feed. An @handle is looked
 * up on the channel's own public page (no key, no account); if YouTube doesn't answer with the
 * channel page, the admin is asked for the UC… id instead.
 */
export async function resolveChannel(ref: ChannelRef, options: { fetchImpl?: Fetch; timeoutMs?: number } = {}): Promise<ResolvedChannel> {
  let channelId = ref.kind === "id" ? ref.channelId : null;
  if (ref.kind === "handle") {
    try {
      const response = await (options.fetchImpl ?? fetch)(`https://www.youtube.com/@${encodeURIComponent(ref.handle)}`, {
        headers: { "User-Agent": FEED_USER_AGENT, Accept: "text/html", "Accept-Language": "en" },
        cache: "no-store",
        signal: AbortSignal.timeout(options.timeoutMs ?? FEED_TIMEOUT_MS),
      });
      if (response.ok) channelId = channelIdFromPage((await response.text()).slice(0, FEED_MAX_BYTES));
    } catch {}
    if (!channelId)
      return { ok: false, error: `Couldn't find @${ref.handle} from its public page. Paste the channel's id (it starts with UC) or its youtube.com/channel/UC… address instead.` };
  }
  const feed = await fetchChannelFeed(channelId!, options);
  if (!feed.ok)
    return { ok: false, error: feed.error === "HTTP 404" ? "YouTube has no public channel with that id." : "That channel's public feed couldn't be read just now. Please try again." };
  return { ok: true, channelId: channelId!, name: feedChannelName(feed.xml) || channelId! };
}
