import { describe, expect, it } from "vitest";
import {
  PICKS_STATE_KEY,
  effectiveScore,
  emptyPicksState,
  hideVideo,
  loadPicksState,
  picksWeights,
  relativeDay,
  restoreAllHidden,
  sanitizePicksState,
  savePicksState,
  setWatched,
  toggleLike,
  unhideVideo,
} from "@/lib/videoPicksState";

// #529 Booker Tube: what one browser remembers (watched, More like this, Not for me, the last filter).

const video = (id: string, channelId = "UCa", primaryTopic: string | null = "t1", score = 10, topics = primaryTopic ? [primaryTopic] : []) => ({ id, channelId, primaryTopic, score, topics });
const NOW = Date.parse("2026-11-26T12:00:00Z");

describe("marks", () => {
  it("More like this lifts the video, its channel and its topic; pressing again takes it all back", () => {
    const a = video("a"), sameChannel = video("b"), sameTopic = video("c", "UCb"), other = video("d", "UCb", "t2");
    let state = toggleLike(emptyPicksState(), a, NOW);
    let weights = picksWeights(state);
    expect([a, sameChannel, sameTopic, other].map((item) => effectiveScore(item, weights, !!state.liked[item.id]))).toEqual([14, 12.5, 11, 10]);
    state = toggleLike(state, a, NOW);
    weights = picksWeights(state);
    expect(state).toEqual(emptyPicksState());
    expect(effectiveScore(sameChannel, weights, false)).toBe(10);
  });

  it("Not for me hides and leans away; Undo restores exactly, a like included", () => {
    const a = video("a");
    const liked = toggleLike(emptyPicksState(), a, NOW);
    const hidden = hideVideo(liked, a, NOW);
    expect(hidden.liked).toEqual({});
    expect(hidden.hidden.a).toEqual({ at: NOW, channelId: "UCa", topic: "t1", wasLiked: true });
    expect(effectiveScore(video("b"), picksWeights(hidden), false)).toBe(10 - 1.5 - 0.75);
    // The prototype forgot the like on Undo.
    expect(unhideVideo(hidden, "a")).toEqual(liked);
    expect(unhideVideo(liked, "zzz")).toBe(liked);
    const two = hideVideo(hideVideo(emptyPicksState(), a, NOW), video("b", "UCb"), NOW);
    expect(restoreAllHidden(two)).toEqual(emptyPicksState());
  });

  it("leanings are capped, and taking marks back always returns to where it started", () => {
    // The prototype kept running totals and capped them, so eleven likes and eleven un-likes left a channel at -6.5.
    let state = emptyPicksState();
    const many = Array.from({ length: 11 }, (_, index) => video(`v${index}`));
    for (const item of many) state = toggleLike(state, item, NOW);
    expect(picksWeights(state).channels.get("UCa")).toBe(10);
    expect(picksWeights(state).topics.get("t1")).toBe(10);
    for (const item of many) state = toggleLike(state, item, NOW);
    expect(picksWeights(state).channels.get("UCa")).toBeUndefined();
    expect(effectiveScore(video("x"), picksWeights(state), false)).toBe(10);
    let away = emptyPicksState();
    for (const item of many) away = hideVideo(away, item, NOW);
    expect(picksWeights(away).channels.get("UCa")).toBe(-10);
  });

  it("a video without a topic only moves its channel", () => {
    const state = toggleLike(emptyPicksState(), video("a", "UCa", null), NOW);
    expect([...picksWeights(state).topics]).toEqual([]);
    expect(picksWeights(state).channels.get("UCa")).toBe(1.5);
  });

  it("watched on and off", () => {
    const on = setWatched(emptyPicksState(), "a", true, NOW);
    expect(on.watched).toEqual({ a: NOW });
    expect(setWatched(on, "a", true, NOW + 5)).toBe(on);
    expect(setWatched(on, "a", false).watched).toEqual({});
  });
});

describe("storage", () => {
  const store = (initial?: string) => {
    const data = new Map<string, string>(initial === undefined ? [] : [[PICKS_STATE_KEY, initial]]);
    return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), data };
  };

  it("saves and loads", () => {
    const kept = store();
    const state = { ...hideVideo(toggleLike(setWatched(emptyPicksState(), "w", true, Date.now()), video("a"), Date.now()), video("b"), Date.now()), filter: { area: "fun", topic: "birds", query: "owl", sort: "newest" as const } };
    expect(savePicksState(state, kept)).toBe(true);
    expect(loadPicksState(kept)).toEqual(state);
  });

  it("survives a browser that refuses storage, and damaged or hostile contents", () => {
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("full"); } };
    expect(loadPicksState(broken)).toEqual(emptyPicksState());
    expect(savePicksState(emptyPicksState(), broken)).toBe(false);
    expect(loadPicksState(null)).toEqual(emptyPicksState());
    expect(savePicksState(emptyPicksState(), null)).toBe(false);
    for (const junk of ["{", "null", "[]", '"text"', "42"]) expect(loadPicksState(store(junk))).toEqual(emptyPicksState());
    const cleaned = sanitizePicksState(
      {
        theme: "dark",
        filter: { area: 7, topic: "t".repeat(500), query: "q".repeat(500), sort: "sideways" },
        watched: { ok: NOW, yes: true, "bad id!": NOW, text: "x", old: NOW - 300 * 86_400_000 },
        hidden: { a: { at: NOW, channelId: "UCa", primaryTopic: "t1" }, b: "nope", "x y": {}, old: { at: NOW - 300 * 86_400_000 } },
        liked: { c: { at: "never", channelId: 5 } },
        channelWeights: { UCa: 999 },
      },
      NOW,
    );
    expect(cleaned).toEqual({
      version: 1,
      filter: { area: "all", topic: "t".repeat(80), query: "q".repeat(120), sort: "best" },
      watched: { ok: NOW, yes: NOW },
      hidden: { a: { at: NOW, channelId: "UCa", topic: "t1" } },
      liked: { c: { at: NOW, channelId: "", topic: "" } },
    });
  });
});

describe("the date on a card", () => {
  it("says how long ago in a few words", () => {
    const ago = (days: number) => relativeDay(new Date(NOW - days * 86_400_000).toISOString(), NOW);
    expect([0, 0.9, 1, 3, 13, 14, 29, 59, 60, 89].map(ago)).toEqual(["today", "today", "yesterday", "3 days ago", "13 days ago", "2 weeks ago", "4 weeks ago", "8 weeks ago", "2 months ago", "2 months ago"]);
    expect(ago(-0.5)).toBe("today");
    expect(relativeDay("nonsense", NOW)).toBe("");
  });
});
