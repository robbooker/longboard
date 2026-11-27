import { describe, expect, it } from "vitest";
import {
  channelIdFromPage,
  cleanSnippet,
  decodeXmlEntities,
  feedChannelName,
  isShortVideo,
  isWithinWindow,
  looksLikeFeed,
  mergeVideos,
  parseAtomFeed,
  parseChannelRef,
  scoreVideo,
  videosFromFeed,
  type PicksConfig,
  type PicksVideo,
} from "@/lib/videoPicksFeed";

// #529 Booker Tube: reading a channel feed, leaving out Shorts and old videos, scoring and penalties.

const NOW = Date.parse("2026-11-26T12:00:00Z");
const DAY = 86_400_000;
const CHANNEL = { channelId: "UCg3B_joekBGJ1s_4fRjsMKA", name: "SMB Capital", area: "trading", topics: ["low-float", "psychology"] };
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();
const entry = (id: string, title: string, options: { days?: number; link?: string; description?: string; extra?: string; channelId?: string } = {}) => `
  <entry>
    <id>yt:video:${id}</id><yt:videoId>${id}</yt:videoId><yt:channelId>${options.channelId ?? CHANNEL.channelId}</yt:channelId>
    <title>${title}</title>
    <link rel="alternate" href="${options.link ?? `https://www.youtube.com/watch?v=${id}`}"/>
    <author><name>SMB Capital</name><uri>https://www.youtube.com/channel/${CHANNEL.channelId}</uri></author>
    <published>${ago(options.days ?? 3)}</published><updated>${ago(options.days ?? 3)}</updated>
    <media:group><media:title>${title}</media:title><media:thumbnail url="https://i2.ytimg.com/vi/${id}/hqdefault.jpg" width="480" height="360"/>
      <media:description>${options.description ?? ""}</media:description>${options.extra ?? ""}</media:group>
  </entry>`;
const feed = (...entries: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <link rel="self" href="https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL.channelId}"/>
  <id>yt:channel:${CHANNEL.channelId}</id><yt:channelId>${CHANNEL.channelId}</yt:channelId>
  <title>SMB Capital &amp; Friends</title>
  <author><name>SMB Capital</name><uri>https://www.youtube.com/channel/${CHANNEL.channelId}</uri></author>
  <published>2011-05-12T15:00:00+00:00</published>${entries.join("")}
</feed>`;
const CONFIG: PicksConfig = {
  scoring: { titleMultiplier: 2.4, descriptionMultiplier: 1, channelTopicPrior: 3.5, recencyHalfLifeDays: 30, recencyMaxBonus: 3, minScoreToInclude: 1 },
  topics: [
    { id: "low-float", area: "trading", label: "Low-float day trading", weight: 1.2, keywords: [{ phrase: "low float", weight: 3.5 }, { phrase: "halt", weight: 1.8 }, { phrase: "level 2", weight: 2.2 }] },
    { id: "shorting", area: "trading", label: "Shorting parabolic runners", weight: 1.3, keywords: [{ phrase: "shorting", weight: 3 }, { phrase: "parabolic", weight: 3.2 }] },
    { id: "psychology", area: "trading", label: "Trading psychology", weight: 1.1, keywords: [{ phrase: "discipline", weight: 2 }] },
    { id: "threejs", area: "building", label: "three.js", weight: 1.2, keywords: [{ phrase: "three.js", weight: 4 }, { phrase: "8-bit", weight: 2 }] },
  ],
  penalties: [
    { phrase: "guaranteed returns", penalty: 8 },
    { phrase: "buy alert", penalty: 7 },
    { phrase: "to the moon", penalty: 5 },
    { phrase: "drama", penalty: 3 },
  ],
};

describe("feed parsing", () => {
  it("reads the videos of a channel feed", () => {
    const xml = feed(
      entry("AJJ-ZSJw7hc", "How To Trade A Low Float Stock &amp; Shorting Parabolic Runners", { description: "Tape reading &amp; level 2.\n0:00 Intro\nhttps://example.invalid/promo" }),
      entry("bbbbbbbbbbb", "<![CDATA[Fish & Chips <live>]]>", { days: 10 }),
    );
    expect(parseAtomFeed(xml)).toEqual([
      {
        id: "AJJ-ZSJw7hc",
        title: "How To Trade A Low Float Stock & Shorting Parabolic Runners",
        channelId: CHANNEL.channelId,
        authorName: "SMB Capital",
        published: ago(3),
        link: "https://www.youtube.com/watch?v=AJJ-ZSJw7hc",
        description: "Tape reading & level 2.\n0:00 Intro\nhttps://example.invalid/promo",
        durationSeconds: null,
      },
      expect.objectContaining({ id: "bbbbbbbbbbb", title: "Fish & Chips <live>", published: ago(10) }),
    ]);
    expect(feedChannelName(xml)).toBe("SMB Capital & Friends");
    expect(looksLikeFeed(xml)).toBe(true);
  });

  it("skips entries without a real video id or a title, and anything that is not a feed", () => {
    const xml = feed(entry("short", "Too short an id"), entry("ccccccccccc", ""), entry('"><script>x', "Bad id"), entry("ddddddddddd", "Fine"));
    expect(parseAtomFeed(xml).map((item) => item.id)).toEqual(["ddddddddddd"]);
    for (const junk of ["", "<html><body>Sign in</body></html>", "<feed", null, undefined, 42]) expect(parseAtomFeed(junk as string)).toEqual([]);
    expect(looksLikeFeed("<html><body>404</body></html>")).toBe(false);
    expect(feedChannelName("<feed><author><name>Only an author</name></author></feed>")).toBe("Only an author");
  });

  it("decodes entities once, and never throws on a bad one", () => {
    expect(decodeXmlEntities("Q&amp;A: 5 &lt; 6 &quot;ok&quot; &#39;x&#39; &#x1F600; &apos;")).toBe("Q&A: 5 < 6 \"ok\" 'x' 😀 '");
    // "&amp;lt;" is the text "&lt;", not "<" (the prototype decoded it twice).
    expect(decodeXmlEntities("&amp;lt;b&amp;gt; &amp;#39; &amp;amp;")).toBe("&lt;b&gt; &#39; &amp;");
    // Not real characters: dropped (the prototype threw a RangeError, which ended its whole run).
    expect(decodeXmlEntities("a&#x110000;b&#55357;c&#0;d&#9999999;e")).toBe("abcde");
    expect(() => parseAtomFeed(feed(entry("eeeeeeeeeee", "Bad &#xFFFFFF; entity")))).not.toThrow();
    expect(parseAtomFeed(feed(entry("eeeeeeeeeee", "Bad &#xFFFFFF; entity")))[0].title).toBe("Bad  entity");
  });

  it("reads a length when a feed carries one", () => {
    const withLength = parseAtomFeed(feed(entry("fffffffffff", "Clip", { extra: '<yt:duration seconds="45"/>' }), entry("ggggggggggg", "Talk", { extra: '<media:content url="x" duration="3600"/>' })));
    expect(withLength.map((item) => item.durationSeconds)).toEqual([45, 3600]);
  });
});

describe("Shorts", () => {
  const video = (title: string, extra: Partial<{ link: string; description: string; durationSeconds: number | null }> = {}) =>
    isShortVideo({ title, link: "https://www.youtube.com/watch?v=aaaaaaaaaaa", description: "", durationSeconds: null, ...extra });

  it("are found by address, length and an explicit tag", () => {
    expect(video("A clip", { link: "https://www.youtube.com/shorts/aaaaaaaaaaa" })).toEqual({ isShort: true, reason: "shorts-url" });
    expect(video("A clip", { durationSeconds: 58 })).toEqual({ isShort: true, reason: "duration" });
    expect(video("A clip", { durationSeconds: 61 }).isShort).toBe(true);
    expect(video("One rule for risk #shorts").reason).toBe("shorts-hashtag");
    expect(video("#Shorts one rule").isShort).toBe(true);
    expect(video("One rule", { description: "Thanks for watching\n#trading #YouTubeShorts" }).isShort).toBe(true);
    expect(video("One rule #ytshorts").isShort).toBe(true);
    expect(video("One rule [Shorts]").reason).toBe("shorts-title-tag");
    expect(video("One rule (YT Shorts)").isShort).toBe(true);
  });

  it("are never the trading words: shorting, short squeeze, short seller, #short", () => {
    for (const title of [
      "Shorting Parabolic Runners Without Blowing Up",
      "How I short low float stocks",
      "The Short Squeeze Explained: shorts get trapped",
      "Short-term trading & the short seller's edge",
      "Why shorts covered into the close",
      "My best #short of the year #shortselling #shortsqueeze",
      "The Big (Short) Trade [short setup]",
      "A short talk about discipline",
    ])
      expect(video(title, { description: "Shorting the frontside. #short #shortseller" }), title).toEqual({ isShort: false, reason: null });
    expect(video("A long talk", { durationSeconds: 62 }).isShort).toBe(false);
    expect(video("A talk", { durationSeconds: 0 }).isShort).toBe(false);
  });
});

describe("the 90-day window", () => {
  it("keeps the last 90 days and nothing older", () => {
    expect(isWithinWindow(ago(0), NOW)).toBe(true);
    expect(isWithinWindow(ago(89.9), NOW)).toBe(true);
    expect(isWithinWindow(ago(90), NOW)).toBe(true);
    expect(isWithinWindow(ago(90.01), NOW)).toBe(false);
    expect(isWithinWindow(ago(400), NOW)).toBe(false);
    expect(isWithinWindow(ago(20), NOW, 14)).toBe(false);
  });
  it("allows a day of clock difference, and refuses a date it cannot read", () => {
    expect(isWithinWindow(ago(-0.5), NOW)).toBe(true);
    expect(isWithinWindow(ago(-2), NOW)).toBe(false);
    expect(isWithinWindow("not a date", NOW)).toBe(false);
    expect(isWithinWindow("", NOW)).toBe(false);
  });
});

describe("scoring", () => {
  const score = (title: string, description = "", days = 0, channel = CHANNEL) => scoreVideo({ title, description, published: ago(days) }, channel, CONFIG, NOW);

  it("adds title and description phrases, the channel's head start and recency", () => {
    const result = score("How to trade a low float stock", "Reading level 2 into the halt.");
    // low-float: (3.5 x 2.4 title + 2.2 + 1.8 description + 3.5 channel) x 1.2 = 19.08; psychology: 3.5 x 1.1 = 3.85 (a quarter counts); +3 new.
    expect(result).toEqual({ score: 23.04, area: "trading", primaryTopic: "low-float", topics: ["low-float", "psychology"], penalty: 0 });
  });

  it("counts a phrase once (the title wins), and only as a whole phrase", () => {
    expect(score("Low float", "low float low float").score).toBe(score("Low float").score);
    // "halts" and "asphalt" are not "halt"; "parabolically" is not "parabolic".
    const none = scoreVideo({ title: "Asphalt halts parabolically", description: "", published: ago(0) }, { area: "fun", topics: [] }, CONFIG, NOW);
    expect(none).toEqual({ score: 3, area: "fun", primaryTopic: null, topics: [], penalty: 0 });
    // Punctuation inside a phrase matches as written.
    const three = scoreVideo({ title: "A three.js scene in 8-bit style", description: "", published: ago(0) }, { area: "fun", topics: [] }, CONFIG, NOW);
    expect(three.primaryTopic).toBe("threejs");
    expect(three.area).toBe("building");
    expect(three.score).toBe(Math.round(((4 + 2) * 2.4 * 1.2 + 3) * 100) / 100);
    expect(scoreVideo({ title: "threeXjs", description: "", published: ago(0) }, { area: "fun", topics: [] }, CONFIG, NOW).primaryTopic).toBeNull();
  });

  it("fades with age: half the bonus every 30 days", () => {
    const fresh = score("Notes").score;
    expect(fresh - score("Notes", "", 30).score).toBeCloseTo(1.5, 2);
    expect(fresh - score("Notes", "", 60).score).toBeCloseTo(2.25, 2);
    expect(score("Notes", "", 30).score).toBeGreaterThan(score("Notes", "", 31).score);
  });

  it("takes the hype penalties off: in full for the title, half for the description", () => {
    const clean = score("Low float stock of the day");
    const title = score("Low float stock of the day: buy alert");
    const description = score("Low float stock of the day", "Buy alert inside.");
    expect(clean.penalty).toBe(0);
    expect(title.penalty).toBe(7);
    expect(description.penalty).toBe(3.5);
    expect(clean.score - title.score).toBeCloseTo(7, 2);
    expect(clean.score - description.score).toBeCloseTo(3.5, 2);
    // Enough hype takes a video to nothing (never below), even from a trusted channel.
    const pump = score("Guaranteed returns! Buy alert! This low float is going to the moon", "No drama.");
    expect(pump.penalty).toBe(21.5);
    expect(pump.score).toBe(0);
    // "dramatic" is not "drama".
    expect(score("A dramatic low float halt").penalty).toBe(0);
  });

  it("falls back to the channel's area when no topic fits", () => {
    expect(scoreVideo({ title: "Hello", description: "", published: ago(1) }, { area: "ideas", topics: [] }, CONFIG, NOW)).toMatchObject({ area: "ideas", primaryTopic: null, topics: [] });
    expect(scoreVideo({ title: "Hello", description: "", published: "nonsense" }, { area: "ideas", topics: [] }, CONFIG, NOW).score).toBe(0);
  });
});

describe("a channel's videos", () => {
  it("keeps what belongs and says what it left out", () => {
    const xml = feed(
      entry("AJJ-ZSJw7hc", "Shorting Parabolic Runners On A Low Float", { days: 2, description: "Subscribe to the channel\nTape reading and level 2 exhaustion.\n0:00 Intro\nhttps://example.invalid/promo" }),
      entry("shortsurl01", "Quick clip", { days: 1, link: "https://www.youtube.com/shorts/shortsurl01" }),
      entry("shortstag01", "One rule #shorts", { days: 1 }),
      entry("tooold00001", "Low float recap", { days: 120 }),
      entry("hype0000001", "Guaranteed returns buy alert to the moon", { days: 1 }),
      entry("other000001", "Someone else's video", { channelId: "UCaaaaaaaaaaaaaaaaaaaaaa" }),
      entry("plain000001", "Morning notes", { days: 5 }),
    );
    const { videos, tally } = videosFromFeed(xml, CHANNEL, CONFIG, NOW);
    expect(tally).toEqual({ parsed: 6, old: 1, shorts: 2, lowScore: 1 });
    expect(videos.map((video) => video.id)).toEqual(["AJJ-ZSJw7hc", "plain000001"]);
    expect(videos[0]).toEqual({
      id: "AJJ-ZSJw7hc",
      title: "Shorting Parabolic Runners On A Low Float",
      channel: "SMB Capital",
      channelId: CHANNEL.channelId,
      area: "trading",
      published: ago(2),
      snippet: "Tape reading and level 2 exhaustion.",
      topics: ["shorting", "low-float", "psychology"],
      primaryTopic: "shorting",
      score: videos[0].score,
    });
    expect(videos[0].score).toBeGreaterThan(videos[1].score);
    // No picture address is taken from a feed: the page builds it from the checked id.
    expect(JSON.stringify(videos)).not.toContain("ytimg");
    // A shorter window.
    expect(videosFromFeed(xml, CHANNEL, CONFIG, NOW, 3).videos.map((video) => video.id)).toEqual(["AJJ-ZSJw7hc"]);
  });

  it("merges channels best first, and a repeated video keeps its better score", () => {
    const video = (id: string, score: number, days: number): PicksVideo => ({ id, title: id, channel: "c", channelId: CHANNEL.channelId, area: "fun", published: ago(days), snippet: "", topics: [], primaryTopic: null, score });
    expect(mergeVideos([[video("a", 5, 3), video("b", 9, 9)], [video("a", 7, 3), video("c", 9, 1)], []]).map((item) => [item.id, item.score])).toEqual([["c", 9], ["b", 9], ["a", 7]]);
  });

  it("trims a description to a line or two", () => {
    expect(cleanSnippet("")).toBe("");
    expect(cleanSnippet("https://example.invalid/only\n0:00 Intro\nSubscribe now")).toBe("");
    const long = cleanSnippet("word ".repeat(100));
    expect(long.length).toBeLessThanOrEqual(220);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("what an admin types for a channel", () => {
  it("takes an id, a channel address or a handle", () => {
    const id = { kind: "id", channelId: "UCg3B_joekBGJ1s_4fRjsMKA" };
    expect(parseChannelRef(" UCg3B_joekBGJ1s_4fRjsMKA ")).toEqual(id);
    expect(parseChannelRef("https://www.youtube.com/channel/UCg3B_joekBGJ1s_4fRjsMKA")).toEqual(id);
    expect(parseChannelRef("youtube.com/channel/UCg3B_joekBGJ1s_4fRjsMKA/videos?view=0")).toEqual(id);
    expect(parseChannelRef("https://m.youtube.com/channel/UCg3B_joekBGJ1s_4fRjsMKA")).toEqual(id);
    expect(parseChannelRef("@smbcapital")).toEqual({ kind: "handle", handle: "smbcapital" });
    expect(parseChannelRef("https://www.youtube.com/@SMB.Capital-1/videos")).toEqual({ kind: "handle", handle: "SMB.Capital-1" });
  });
  it("refuses everything else", () => {
    for (const value of [
      "",
      "smbcapital",
      "UCshort",
      "UCg3B_joekBGJ1s_4fRjsMKA!",
      "https://example.com/channel/UCg3B_joekBGJ1s_4fRjsMKA",
      "https://youtube.com.evil.test/channel/UCg3B_joekBGJ1s_4fRjsMKA",
      "https://www.youtube.com/watch?v=AJJ-ZSJw7hc",
      "https://www.youtube.com/c/SMBCapital",
      "javascript:alert(1)",
      "@a",
      "@bad/handle",
      "@" + "a".repeat(31),
      "x".repeat(300),
      null,
      42,
    ])
      expect(parseChannelRef(value), String(value)).toBeNull();
  });
  it("finds the channel id a public channel page names as its own", () => {
    expect(channelIdFromPage('<html><head><link rel="canonical" href="https://www.youtube.com/channel/UCg3B_joekBGJ1s_4fRjsMKA"></head></html>')).toBe("UCg3B_joekBGJ1s_4fRjsMKA");
    expect(channelIdFromPage('<meta property="og:url" content="https://www.youtube.com/channel/UCg3B_joekBGJ1s_4fRjsMKA">')).toBe("UCg3B_joekBGJ1s_4fRjsMKA");
    // Another channel's id elsewhere on the page (a featured channel) is not the answer.
    expect(channelIdFromPage('<a href="/channel/UCaaaaaaaaaaaaaaaaaaaaaa">Featured</a> "channelId":"UCaaaaaaaaaaaaaaaaaaaaaa"')).toBeNull();
    expect(channelIdFromPage("<html>Before you continue to YouTube</html>")).toBeNull();
  });
});
