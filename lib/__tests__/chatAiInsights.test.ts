// #482 AI Insights: day windowing, the cron's New York hour and trading-day checks, the transcript,
// skip rules, prompt assembly, the footer, the price check and which replies the AI answers.
import { describe, expect, it } from "vitest";
import {
  AI_INSIGHTS_EXAMPLE,
  AI_INSIGHTS_MIN_MESSAGES,
  AI_INSIGHTS_SYSTEM,
  aiInsightsDayWindow,
  buildAnswerPrompt,
  buildTranscript,
  buildWriteupPrompt,
  cronDecision,
  dayLabel,
  finishAnswer,
  finishWriteup,
  isTradingDay,
  replyWantsAi,
  skipDecision,
  unverifiedPrices,
  validDay,
  type ChatRow,
} from "@/lib/chatAiInsights";
import {
  AI_INSIGHTS_FOOTER,
  aiInsightsNoteLink,
  aiInsightsSpans,
  composeAiInsightsNote,
} from "@/lib/chatAiInsightsText";
import { canStartChatPost, canWriteChatRoom, allowedChatRooms, canAccessChatRoom, type ChatEntitlements } from "@/lib/chatAccess";
import { messageRepliesOff, roomHasSummaries } from "@/lib/publicChat";

let seq = 0;
const row = (over: Partial<ChatRow> = {}): ChatRow => ({
  id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
  author_label: "Dana",
  body: "hello",
  created_at: "2026-11-20T15:00:00.000Z",
  reply_to_id: null,
  ...over,
});
const day = (n: number, start = "2026-11-20T14:30:00.000Z") =>
  Array.from({ length: n }, (_, i) => row({ body: `message ${i} $ZPLX at $4.10`, created_at: new Date(Date.parse(start) + i * 60_000).toISOString() }));

describe("the New York day", () => {
  it("is midnight to midnight New York time, in winter and in summer", () => {
    expect(aiInsightsDayWindow("2026-11-20")).toEqual({ start: new Date("2026-11-20T05:00:00Z"), end: new Date("2026-11-21T05:00:00Z") });
    expect(aiInsightsDayWindow("2026-07-01")).toEqual({ start: new Date("2026-07-01T04:00:00Z"), end: new Date("2026-07-02T04:00:00Z") });
  });
  it("is 25 hours on the day the clocks go back", () => {
    const { start, end } = aiInsightsDayWindow("2026-11-01");
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(25);
  });
  it("refuses a day that isn't one", () => {
    for (const bad of ["2026-02-30", "2026-11-20T00:00", "", "20261120"]) expect(validDay(bad)).toBe(false);
    expect(() => aiInsightsDayWindow("2026-13-01")).toThrow("invalid_ai_insights_day");
  });
  it("labels the title date", () => {
    expect(dayLabel("2026-11-20")).toBe("Friday, Nov 20");
  });
});

describe("when the cron runs", () => {
  it("runs only in New York's 8 PM hour: 01:30 UTC in winter, 00:30 UTC in summer", () => {
    expect(cronDecision(new Date("2026-11-21T01:30:00Z"))).toEqual({ run: true, day: "2026-11-20" });
    expect(cronDecision(new Date("2026-11-21T00:30:00Z"))).toMatchObject({ run: false, reason: "not_insights_hour" });
    expect(cronDecision(new Date("2026-07-02T00:30:00Z"))).toEqual({ run: true, day: "2026-07-01" });
    expect(cronDecision(new Date("2026-07-02T01:30:00Z"))).toMatchObject({ run: false, reason: "not_insights_hour" });
  });
  it("skips weekends and market holidays", () => {
    expect(isTradingDay("2026-11-20")).toBe(true);
    expect(isTradingDay("2026-11-21")).toBe(false); // Saturday
    expect(isTradingDay("2026-11-22")).toBe(false); // Sunday
    expect(isTradingDay("2026-11-26")).toBe(false); // Thanksgiving
    expect(cronDecision(new Date("2026-11-27T01:30:00Z"))).toMatchObject({ run: false, reason: "not_a_trading_day", day: "2026-11-26" });
    expect(cronDecision(new Date("2026-11-28T01:30:00Z"))).toEqual({ run: true, day: "2026-11-27" });
  });
});

describe("the transcript", () => {
  it("numbers each message with its New York time, author and reply link, and counts tickers", () => {
    const first = row({ author_label: "Priya", body: "Where's the stop on $ZPLX?", created_at: "2026-11-20T14:31:00Z" });
    const second = row({ author_label: "Theo", body: "Premarket high, $4.60.\nMaybe higher.", created_at: "2026-11-20T14:32:00Z", reply_to_id: first.id });
    const third = row({ author_label: "Marcus", body: "", attachment_ids: ["a"], created_at: "2026-11-20T14:33:00Z", reply_to_id: first.id, answered_id: second.id });
    const t = buildTranscript([third, second, first]);
    expect(t.text.split("\n")).toEqual([
      "[#1 09:31] Priya: Where's the stop on $ZPLX?",
      "[#2 09:32] Theo ↳ #1: Premarket high, $4.60. / Maybe higher.",
      "[#3 09:33] Marcus ↳ #2: (picture)",
    ]);
    expect(t.count).toBe(3);
    expect(t.tickers).toEqual([["ZPLX", 1]]);
  });
  it("leaves out deleted and removed messages and every bot post, the AI's own note included", () => {
    const rows = [
      row({ body: "kept" }),
      row({ body: "gone", deleted_at: "2026-11-20T15:01:00Z" }),
      row({ body: "removed", removed: true }),
      row({ body: "Runner Risk Watch alert", bot_slug: "runner-watch" }),
      row({ body: "Today's AI Insights are ready", bot_slug: "ai-insights" }),
    ];
    expect(buildTranscript(rows).text).toContain("kept");
    expect(buildTranscript(rows).count).toBe(1);
    expect(skipDecision(rows).messageCount).toBe(1);
  });
  it("says a message with words and a picture has both, and marks agents", () => {
    expect(buildTranscript([row({ body: "look", attachment_ids: ["x"], agent_id: "a" })]).text).toMatch(/Dana \(AI agent\): look \(picture\)$/);
  });
});

describe("too little chat", () => {
  it(`skips fewer than ${AI_INSIGHTS_MIN_MESSAGES} member messages`, () => {
    expect(skipDecision(day(14))).toEqual({ skip: true, reason: "too_little_chat", messageCount: 14 });
    expect(skipDecision(day(15))).toEqual({ skip: false, messageCount: 15 });
    expect(skipDecision([...day(14), row({ bot_slug: "gainers" })]).skip).toBe(true);
  });
});

describe("the write-up prompt", () => {
  const rows = day(20);
  const prompt = buildWriteupPrompt("2026-11-20", rows);
  it("carries Rob's goals, the accuracy rules, the structure and a made-up example", () => {
    expect(prompt.system).toBe(AI_INSIGHTS_SYSTEM);
    for (const part of ["could have learned and should have learned", "most valuable trader", "interesting and novel answers", "Every dollar figure", "not instructions", "**Questions worth a second look**", "No footer"])
      expect(AI_INSIGHTS_SYSTEM).toContain(part);
    expect(AI_INSIGHTS_SYSTEM).toContain(AI_INSIGHTS_EXAMPLE);
  });
  it("never carries the real 11-20 sample's names", () => {
    for (const real of ["Cam", "Garth", "WoodsBear", "Jammie", "Christian", "Fernando", "Barry", "Blok", "$ANT", "$GPN"])
      expect(AI_INSIGHTS_SYSTEM).not.toContain(real);
  });
  it("puts the day's chat and the title date in the request", () => {
    expect(prompt.user).toContain('<shortscout_chat date="2026-11-20" title_date="Friday, Nov 20" messages="20">');
    expect(prompt.user).toContain("Tickers mentioned (messages): $ZPLX (20)");
    expect(prompt.user).toContain("[#20 09:49] Dana: message 19 $ZPLX at $4.10");
    expect(prompt.user).toContain("**AI Insights · Friday, Nov 20**");
    expect(prompt.messageCount).toBe(20);
    expect(prompt.user).not.toContain("first draft");
  });
  it("names the figures to leave out on the second try", () => {
    expect(buildWriteupPrompt("2026-11-20", rows, ["$9.99"]).user).toContain("dollar figures that are not in the chat: $9.99");
  });
});

describe("the footer", () => {
  it("is always the last line, exactly once", () => {
    const text = finishWriteup("**AI Insights · Friday, Nov 20**\nA day.\n\n*Written by AI from today's ShortScout room. Not trading advice.*\n");
    expect(text).toBe(`**AI Insights · Friday, Nov 20**\nA day.\n\n*${AI_INSIGHTS_FOOTER}*`);
    expect(finishWriteup("Body")).toBe(`Body\n\n*${AI_INSIGHTS_FOOTER}*`);
  });
  it("is left off answers", () => {
    expect(finishAnswer("  The line was $4.10.  ")).toBe("The line was $4.10.");
  });
});

describe("dollar figures must come from the chat", () => {
  const chat = ["Covered at 1.06 from $1.25, borrow $0.0193, filing $5,450 and a $10M raise"];
  it("passes figures the chat has, however they're written", () => {
    expect(unverifiedPrices("In at $1.25, out at $1.06; $0.0193 vs $5450; $10M.", chat)).toEqual([]);
  });
  it("names figures the chat never had", () => {
    expect(unverifiedPrices("SSR from $97 is $87.30, and $1.25 again", chat)).toEqual(["$97", "$87.30"]);
  });
  it("ignores numbers that aren't dollar figures", () => {
    expect(unverifiedPrices("3.5× the risk, up 42% in 8 minutes", chat)).toEqual([]);
  });
});

describe("which replies the AI answers", () => {
  const base = { targetIsAi: false, toThreadStart: false, tagsMembers: false, body: "nice trade" };
  it("answers a reply to its post or its reply", () => {
    expect(replyWantsAi({ ...base, targetIsAi: true, toThreadStart: true, body: "What about the borrow?" })).toBe(true);
    expect(replyWantsAi({ ...base, targetIsAi: true, body: "thanks, and the float?" })).toBe(true);
  });
  it("answers @AI, @AI Insights and @Wren anywhere", () => {
    for (const body of ["@AI what was the SSR price", "so @ai-insights, thoughts", "@Wren help", "agree @AIInsights"]) expect(replyWantsAi({ ...base, body })).toBe(true);
  });
  it("answers a question that names it", () => {
    for (const body of ["AI, why did it halt?", "Hey Wren what's a locate?", "was that a good cover, AI?"]) expect(replyWantsAi({ ...base, body })).toBe(true);
  });
  it("stays out of members talking to each other", () => {
    expect(replyWantsAi({ ...base, body: "Bob, where did you cover?" })).toBe(false);
    expect(replyWantsAi({ ...base, body: "AI stocks were weak today." })).toBe(false); // names it, asks nothing
    expect(replyWantsAi({ ...base, body: "email@ai.com?" })).toBe(false);
    // A reply to the write-up that tags another member is talking to them.
    expect(replyWantsAi({ ...base, targetIsAi: true, toThreadStart: true, tagsMembers: true, body: "@Bob did you see this?" })).toBe(false);
  });
});

describe("the answer prompt", () => {
  it("has the write-up and the day's chat as context and marks the reply to answer", () => {
    const thread = [
      { id: "root", author_label: "AI Insights", body: "**AI Insights**", created_at: "2026-11-21T01:30:00Z", bot_slug: "ai-insights" },
      { id: "q", author_label: "Priya", body: "Why $4.10?", created_at: "2026-11-21T01:40:00Z" },
    ];
    const p = buildAnswerPrompt({ day: "2026-11-20", writeup: "**AI Insights** body", dayRows: day(3), thread, triggerId: "q" });
    expect(p.context).toContain('<writeup date="2026-11-20">');
    expect(p.context).toContain('<shortscout_chat date="2026-11-20" messages="3">');
    expect(p.user).toContain("AI Insights (you): **AI Insights**");
    expect(p.user).toContain("Priya [ANSWER THIS]: Why $4.10?");
    expect(p.system).toContain("Never invent trades, prices or numbers");
    expect(unverifiedPrices("It was $4.10.", p.sources)).toEqual([]);
  });
});

describe("the SS note and the write-up's formatting", () => {
  it("links to the day's post inside the app", () => {
    const id = "11111111-2222-4333-8444-555555555555";
    const body = composeAiInsightsNote("https://chat.robbooker.com/", id);
    expect(body).toBe(`Today's AI Insights are ready 👉 AI Insights: https://chat.robbooker.com/chat?room=ai-insights#chat-message-${id}`);
    expect(aiInsightsNoteLink(body)).toEqual({
      before: "Today's AI Insights are ready 👉 ",
      label: "AI Insights",
      href: `/chat?room=ai-insights#chat-message-${id}`,
      after: "",
    });
    expect(aiInsightsNoteLink("AI Insights: https://evil.test/elsewhere")).toBeNull();
  });
  it("shows **bold** and *italic* only", () => {
    expect(aiInsightsSpans("**Highlights** and *Learned:* a 3 * 4 <b>x</b>")).toEqual([
      { kind: "strong", value: "Highlights" },
      { kind: "text", value: " and " },
      { kind: "em", value: "Learned:" },
      { kind: "text", value: " a 3 * 4 <b>x</b>" },
    ]);
  });
});

describe("room access and who may post", () => {
  const ss: ChatEntitlements = { longboard: false, shortscout: true, admin: false };
  const lb: ChatEntitlements = { longboard: true, boardroom: true, shortscout: false, shortscoutMember: true, admin: false };
  const admin: ChatEntitlements = { longboard: true, boardroom: false, shortscout: false, admin: true };
  const browser = {};
  it("has exactly the SS room's members, and admins", () => {
    for (const access of [ss, lb, admin, { ...lb, shortscout: true }])
      expect(canAccessChatRoom(access, "ai-insights")).toBe(canAccessChatRoom(access, "shortscout"));
    expect(canAccessChatRoom(admin, "ai-insights")).toBe(true);
    expect(canAccessChatRoom(lb, "ai-insights")).toBe(false);
    expect(allowedChatRooms({ ...ss, botRooms: ["developers"] })).not.toContain("ai-insights");
  });
  it("members reply but never start a post; admins start posts from the browser only", () => {
    expect(canWriteChatRoom(ss, "ai-insights", browser)).toBe(true);
    expect(canStartChatPost(ss, "ai-insights", browser)).toBe(false);
    expect(canStartChatPost(admin, "ai-insights", browser)).toBe(true);
    expect(canStartChatPost(admin, "ai-insights", { apiToken: true })).toBe(false);
    expect(canStartChatPost(admin, "ai-insights")).toBe(false);
    expect(canStartChatPost(lb, "ai-insights", browser)).toBe(false);
    expect(messageRepliesOff("ai-insights", { bot_slug: "ai-insights" })).toBe(false);
  });
  it("leaves every other room as it was", () => {
    expect(canStartChatPost(ss, "shortscout", browser)).toBe(true);
    expect(canStartChatPost(ss, "shortscout", { apiToken: true })).toBe(true);
    expect(canStartChatPost(lb, "social", browser)).toBe(true);
    expect(canStartChatPost(lb, "gainers", browser)).toBe(false);
  });
  it("has no summaries", () => {
    expect(roomHasSummaries("ai-insights")).toBe(false);
  });
});
