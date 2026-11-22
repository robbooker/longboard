import { describe, expect, it } from "vitest";
import {
  easternAt,
  feedWindow,
  firstName,
  firstNamesOnly,
  gainerHeadlines,
  isMemberQuestion,
  marketHeadlines,
  parseFeedDate,
  parseGainersLimit,
  pickQuestion,
  previousTradingDay,
  rankPremarketGainers,
  type RoomMessageRow,
} from "@/lib/producerFeed";

// #484 PRODUCER-FEED: the rules behind /api/producer/morning.
const DAY = "2026-11-23"; // a Monday
const at = (h: number, m = 0) => new Date(easternAt(DAY, h, m)).toISOString();
const OPEN = easternAt(DAY, 9, 30);
const alert = (sym: string, pct: number, h: number, m: number, vol: number, extra = "") => ({
  id: `${sym}-${h}-${m}`,
  created_at: at(h, m),
  body: `🚨 ${sym} (+${pct}%) 🕒 Pre-Market\n🕒 Extended Price: $${(pct / 10).toFixed(2)} (+${pct}%)\n💵 Price: $1.00\n📊 Volume: ${vol.toLocaleString("en-US")}${extra}`,
});

describe("days and windows", () => {
  it("defaults the date to today in New York and refuses bad ones", () => {
    // 2026-11-23 03:00 UTC is still Sunday the 22nd in New York.
    expect(parseFeedDate(null, Date.parse("2026-11-23T03:00:00Z"))).toBe("2026-11-22");
    expect(parseFeedDate("2026-11-23")).toBe("2026-11-23");
    expect(parseFeedDate("2026-02-30")).toBeNull();
    expect(parseFeedDate("11/23/2026")).toBeNull();
  });
  it("limits gainers to 1-10, 3 by default", () => {
    expect(parseGainersLimit(null)).toBe(3);
    expect(parseGainersLimit("10")).toBe(10);
    expect(parseGainersLimit("0")).toBeNull();
    expect(parseGainersLimit("11")).toBeNull();
    expect(parseGainersLimit("2.5")).toBeNull();
  });
  it("finds the previous trading day's close across weekends and holidays", () => {
    expect(previousTradingDay("2026-11-23")).toBe("2026-11-20"); // Monday -> Friday
    expect(previousTradingDay("2026-11-27")).toBe("2026-11-25"); // after Thanksgiving
    expect(new Date(feedWindow("2026-11-24", Date.parse("2026-11-24T20:00:00Z")).questionsSince).toISOString()).toBe(
      "2026-11-23T21:00:00.000Z",
    );
  });
  it("stops the window at 9:30am New York, or now when earlier", () => {
    expect(feedWindow(DAY, Date.parse("2026-11-23T18:00:00Z")).until).toBe(OPEN);
    expect(feedWindow(DAY, Date.parse("2026-11-23T12:50:00Z")).until).toBe(Date.parse("2026-11-23T12:50:00Z"));
  });
});

describe("premarket gainers", () => {
  it("ranks by the latest % move, premarket only, with the room's 150K rule", () => {
    const rows = [
      alert("AAA", 40, 6, 0, 200_000),
      alert("AAA", 95.5, 7, 40, 900_000), // latest AAA move
      alert("BBB", 120, 7, 0, 90_000), // never 150K: left out
      alert("CCC", 60, 5, 10, 160_000),
      alert("DDD", 300, 9, 31, 2_000_000), // after the open: left out
      alert("EEE", 70, 8, 0, 500_000),
      alert("FFF", 80, 8, 5, 500_000, "\nAfter-Hours"), // after-hours alert: left out
      { id: "x", created_at: at(7), body: "not an alert?" },
    ];
    const ranked = rankPremarketGainers(rows, OPEN, 3);
    expect(ranked.map((g) => g.symbol)).toEqual(["AAA", "EEE", "CCC"]);
    expect(ranked[0]).toEqual({ symbol: "AAA", change_pct: 95.5, price: 9.55, first_alert_at: at(6) });
    expect(rankPremarketGainers(rows, OPEN, 10).map((g) => g.symbol)).toEqual(["AAA", "EEE", "CCC"]);
  });
  it("uses the regular price when there is no extended price", () => {
    const rows = [{ id: "1", created_at: at(8), body: "🚨 BRK.B (+5.10%)\n💵 Price: $1,234.50\n📊 Volume: 151,000" }];
    expect(rankPremarketGainers(rows, OPEN)).toEqual([{ symbol: "BRK.B", change_pct: 5.1, price: 1234.5, first_alert_at: at(8) }]);
  });
  it("keeps three DilutionTracker headlines per ticker, newest first, none after the window", () => {
    const rows = [1, 2, 3, 4].map((d) => ({ ticker: "AAA", published_at: `2026-11-${18 + d}T12:00:00Z`, title: `Release ${d}`, url: "https://dilution.news/x" }));
    rows.push({ ticker: "AAA", published_at: "2026-11-23T15:00:00Z", title: "After the open", url: "https://dilution.news/y" });
    const got = gainerHeadlines(rows, OPEN).get("AAA")!;
    expect(got.map((h) => h.title)).toEqual(["Release 4", "Release 3", "Release 2"]);
    expect(got[0]).toEqual({ title: "Release 4", published_at: "2026-11-22T12:00:00.000Z", source: "DilutionTracker", url: "https://dilution.news/x" });
  });
});

describe("the ShortScout question", () => {
  const msg = (id: string, extra: Partial<RoomMessageRow> = {}): RoomMessageRow => ({
    id,
    author_label: "Sam Ortiz",
    body: "How do you size a short into a premarket spike?",
    created_at: at(7),
    reply_to_id: null,
    member_id: `m-${id}`,
    guest_id: null,
    bot_slug: null,
    agent_id: null,
    deleted_at: null,
    removed: false,
    ...extra,
  });
  it("only counts a human member's live, substantive top-level question", () => {
    expect(isMemberQuestion(msg("a"))).toBe(true);
    expect(isMemberQuestion(msg("a", { bot_slug: "ai-insights" }))).toBe(false);
    expect(isMemberQuestion(msg("a", { agent_id: "agent-1" }))).toBe(false);
    expect(isMemberQuestion(msg("a", { member_id: null }))).toBe(false);
    expect(isMemberQuestion(msg("a", { deleted_at: at(7) }))).toBe(false);
    expect(isMemberQuestion(msg("a", { removed: true }))).toBe(false);
    expect(isMemberQuestion(msg("a", { reply_to_id: "b" }))).toBe(false);
    expect(isMemberQuestion(msg("a", { body: "Anyone in?" }))).toBe(false);
    expect(isMemberQuestion(msg("a", { body: "look at this chart https://x.test/a?b=1" }))).toBe(false);
  });
  it("picks the newest unanswered one; a reply from anyone else answers it", () => {
    const older = msg("older", { created_at: at(6), author_label: "Jo Lee", body: "What is the borrow on ABCD this morning?" });
    const answered = msg("answered", { created_at: at(8) });
    const selfReply = msg("self", { created_at: at(7), author_label: "Pat Kim", body: "Is the gap fill on XYZ a good short today?" });
    const bot = msg("bot", { created_at: at(9), bot_slug: "ai-insights" });
    const replies = [
      msg("r1", { reply_to_id: "answered", member_id: "m-other" }),
      msg("r2", { reply_to_id: "self", member_id: "m-self" }), // the asker's own follow-up
      msg("r3", { reply_to_id: "older", member_id: "m-other", deleted_at: at(7) }), // deleted: no answer
    ];
    expect(pickQuestion([older, answered, selfReply, bot], replies)).toEqual({
      first_name: "Pat",
      body: "Is the gap fill on XYZ a good short today?",
      posted_at: at(7),
    });
    expect(pickQuestion([older, answered], replies)?.first_name).toBe("Jo");
    expect(pickQuestion([answered], replies)).toBeNull();
  });
  it("shows first names only", () => {
    expect(firstName("Sam Ortiz")).toBe("Sam");
    expect(firstName("  Wren  ")).toBe("Wren");
    expect(firstNamesOnly("@Jammie Smith what do you think of ABCD?")).toBe("@Jammie what do you think of ABCD?");
    expect(firstNamesOnly("@Rob is $ABCD a short?")).toBe("@Rob is $ABCD a short?");
  });
});

describe("market headlines", () => {
  it("blends Polygon and FMP, newest first, one per headline, at most ten", () => {
    const polygon = Array.from({ length: 8 }, (_, i) => ({
      id: `p${i}`,
      title: `Stocks rally as yields fall, part ${i}`,
      article_url: `https://www.benzinga.com/${i}`,
      published_utc: `2026-11-23T1${i}:00:00Z`,
      publisher: { name: "Benzinga" },
    }));
    const fmp = [
      { title: "Stocks rally as yields fall, part 7", url: "https://reuters.com/a", publishedDate: "2026-11-23 06:00:00", publisher: "Reuters" },
      { title: "Fed minutes point to a December pause", url: "https://reuters.com/b", publishedDate: "2026-11-23 05:00:00", publisher: "Reuters" },
      { title: "Oil slips on supply worries in early trade", url: "https://cnbc.com/c", publishedDate: "2026-11-23 04:00:00", publisher: "CNBC" },
      { title: "Shareholder alert: class action filed", url: "https://x.com/d", publishedDate: "2026-11-23 07:00:00", publisher: "PR" },
      { title: "Les actions montent fortement à Paris", url: "https://x.com/e", publishedDate: "2026-11-23 07:00:00", publisher: "X" },
    ];
    const got = marketHeadlines(polygon, fmp);
    expect(got).toHaveLength(10);
    expect(got[0]).toEqual({ title: "Stocks rally as yields fall, part 7", source: "Benzinga", url: "https://www.benzinga.com/7", published_at: "2026-11-23T17:00:00.000Z" });
    expect(got.filter((h) => h.title.endsWith("part 7"))).toHaveLength(1);
    expect(got.some((h) => /class action|actions/i.test(h.title))).toBe(false);
    expect(got[9].title).toBe("Oil slips on supply worries in early trade");
  });
});
