// #529 Booker Tube: what one browser remembers about the page. Nothing here leaves the device:
// the last filter, which videos were watched, "More like this" and "Not for me". Every read and
// write of localStorage is guarded, so a private window or a full disk only loses the memory.

export const PICKS_STATE_KEY = "longboard-booker-tube-v1";

export type PicksSort = "best" | "newest";
export type PicksFilter = { area: string; topic: string; query: string; sort: PicksSort };
/** Which channel and topic a mark counts for, kept with the mark so it can be taken back exactly. */
export type PicksMark = { at: number; channelId: string; topic: string; wasLiked?: boolean };
export type PicksState = {
  version: 1;
  filter: PicksFilter;
  watched: Record<string, number>;
  hidden: Record<string, PicksMark>;
  liked: Record<string, PicksMark>;
};
type Markable = { id: string; channelId: string; primaryTopic: string | null };
type Scorable = Markable & { score: number; topics: string[] };

export const DEFAULT_FILTER: PicksFilter = { area: "all", topic: "all", query: "", sort: "best" };
export const emptyPicksState = (): PicksState => ({ version: 1, filter: { ...DEFAULT_FILTER }, watched: {}, hidden: {}, liked: {} });

const LIKE = { channel: 1.5, topic: 1, video: 1.5 };
const HIDE = { channel: -1.5, topic: -0.75 };
const WEIGHT_LIMIT = 10;
/** Marks older than this are forgotten: the videos left the page (90 days) long before. */
const KEEP_MS = 200 * 86_400_000;
const MAX_MARKS = 3000;
const ID = /^[A-Za-z0-9_-]{1,32}$/;

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const short = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");

function marks(raw: unknown, now: number): Record<string, PicksMark> {
  const kept: Record<string, PicksMark> = {};
  if (!isObject(raw)) return kept;
  for (const [id, value] of Object.entries(raw).slice(0, MAX_MARKS)) {
    if (!ID.test(id) || !isObject(value)) continue;
    const at = typeof value.at === "number" && Number.isFinite(value.at) ? value.at : now;
    if (now - at > KEEP_MS) continue;
    kept[id] = { at, channelId: short(value.channelId, 40), topic: short(value.topic ?? value.primaryTopic, 80), ...(value.wasLiked === true ? { wasLiked: true } : {}) };
  }
  return kept;
}

/** Whatever was stored, as a state that is safe to use (unknown or damaged parts are dropped). */
export function sanitizePicksState(raw: unknown, now = Date.now()): PicksState {
  const state = emptyPicksState();
  if (!isObject(raw)) return state;
  if (isObject(raw.filter)) {
    state.filter = {
      area: short(raw.filter.area, 40) || "all",
      topic: short(raw.filter.topic, 80) || "all",
      query: short(raw.filter.query, 120),
      sort: raw.filter.sort === "newest" ? "newest" : "best",
    };
  }
  if (isObject(raw.watched)) {
    for (const [id, value] of Object.entries(raw.watched).slice(0, MAX_MARKS)) {
      const at = typeof value === "number" && Number.isFinite(value) ? value : value === true ? now : null;
      if (ID.test(id) && at !== null && now - at <= KEEP_MS) state.watched[id] = at;
    }
  }
  state.hidden = marks(raw.hidden, now);
  state.liked = marks(raw.liked, now);
  return state;
}

type Store = Pick<Storage, "getItem" | "setItem">;
const browserStore = (): Store | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

export function loadPicksState(store: Store | null = browserStore()): PicksState {
  try {
    const saved = store?.getItem(PICKS_STATE_KEY);
    return saved ? sanitizePicksState(JSON.parse(saved)) : emptyPicksState();
  } catch {
    return emptyPicksState();
  }
}

export function savePicksState(state: PicksState, store: Store | null = browserStore()) {
  try {
    store?.setItem(PICKS_STATE_KEY, JSON.stringify(state));
    return !!store;
  } catch {
    return false;
  }
}

const mark = (video: Markable, now: number): PicksMark => ({ at: now, channelId: video.channelId ?? "", topic: video.primaryTopic ?? "" });
const without = <T>(map: Record<string, T>, id: string) => {
  const next = { ...map };
  delete next[id];
  return next;
};

export function setWatched(state: PicksState, id: string, watched: boolean, now = Date.now()): PicksState {
  if (watched === id in state.watched) return state;
  return { ...state, watched: watched ? { ...state.watched, [id]: now } : without(state.watched, id) };
}

/** "More like this", on or off. */
export function toggleLike(state: PicksState, video: Markable, now = Date.now()): PicksState {
  return { ...state, liked: state.liked[video.id] ? without(state.liked, video.id) : { ...state.liked, [video.id]: mark(video, now) } };
}

/** "Not for me": hides the video and leans away from its channel and topic. A like on it is set aside. */
export function hideVideo(state: PicksState, video: Markable, now = Date.now()): PicksState {
  const wasLiked = !!state.liked[video.id];
  return { ...state, liked: without(state.liked, video.id), hidden: { ...state.hidden, [video.id]: { ...mark(video, now), ...(wasLiked ? { wasLiked } : {}) } } };
}

/** Undo for "Not for me": the video is back exactly as it was, a like included. */
export function unhideVideo(state: PicksState, id: string): PicksState {
  const was = state.hidden[id];
  if (!was) return state;
  const { wasLiked, ...rest } = was;
  return { ...state, hidden: without(state.hidden, id), liked: wasLiked ? { ...state.liked, [id]: rest } : state.liked };
}

export function restoreAllHidden(state: PicksState): PicksState {
  return Object.keys(state.hidden).reduce(unhideVideo, state);
}

export type PicksWeights = { channels: Map<string, number>; topics: Map<string, number> };

/**
 * How much this browser leans towards or away from each channel and topic. Worked out from the
 * marks themselves every time, so taking a mark back always undoes exactly what it added.
 */
export function picksWeights(state: Pick<PicksState, "liked" | "hidden">): PicksWeights {
  const channels = new Map<string, number>();
  const topics = new Map<string, number>();
  const add = (map: Map<string, number>, key: string, amount: number) => key && map.set(key, (map.get(key) ?? 0) + amount);
  for (const item of Object.values(state.liked)) {
    add(channels, item.channelId, LIKE.channel);
    add(topics, item.topic, LIKE.topic);
  }
  for (const item of Object.values(state.hidden)) {
    add(channels, item.channelId, HIDE.channel);
    add(topics, item.topic, HIDE.topic);
  }
  const clamp = (map: Map<string, number>) => {
    for (const [key, value] of map) map.set(key, Math.max(-WEIGHT_LIMIT, Math.min(WEIGHT_LIMIT, value)));
    return map;
  };
  return { channels: clamp(channels), topics: clamp(topics) };
}

/** The collection's score for a video, moved by this browser's leanings. */
export function effectiveScore(video: Scorable, weights: PicksWeights, liked: boolean) {
  const topics = (video.topics ?? []).reduce((sum, topic) => sum + (weights.topics.get(topic) ?? 0), 0);
  return Math.round(((Number(video.score) || 0) + (weights.channels.get(video.channelId) ?? 0) + topics + (liked ? LIKE.video : 0)) * 100) / 100;
}

/** "today", "3 days ago", "4 weeks ago", "2 months ago". */
export function relativeDay(published: string, now = Date.now()) {
  const at = Date.parse(published);
  if (!Number.isFinite(at)) return "";
  const days = Math.floor((now - at) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  const months = Math.floor(days / 30);
  return `${months} ${months === 1 ? "month" : "months"} ago`;
}
