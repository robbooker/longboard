import { describe, expect, it } from "vitest";
import { FAQ_ANSWER_MAX, FAQ_QUESTION_MAX, FAQ_TOPIC_MAX, faqItemTitle, parseFaqItemInput, parseFaqReview, parseFaqSuggestion, searchFaqItems } from "@/lib/chatFaq";

// #332: validation and the FAQ's own search.
const items = [
  { id: "1", question: "How do I get the chat on my phone?", answer: "iPhone: Add to Home Screen.\nAndroid: Install app." },
  { id: "2", question: "How do I turn on phone notifications?", answer: "Open the ⋯ menu.\nTap Enable notifications." },
];

describe("searchFaqItems", () => {
  it("shows everything for an empty search", () => {
    expect(searchFaqItems(items, "   ")).toEqual(items);
  });
  it("searches questions and answers, ignoring case", () => {
    expect(searchFaqItems(items, "NOTIFICATIONS").map((item) => item.id)).toEqual(["2"]);
    expect(searchFaqItems(items, "home screen").map((item) => item.id)).toEqual(["1"]);
    expect(searchFaqItems(items, "phone").map((item) => item.id)).toEqual(["1", "2"]);
  });
  it("needs every word, in any order", () => {
    expect(searchFaqItems(items, "android phone").map((item) => item.id)).toEqual(["1"]);
    expect(searchFaqItems(items, "android enable")).toEqual([]);
  });
  it("reads curly apostrophes and accents the same as plain ones", () => {
    const rows = [{ id: "a", question: "What's a café?", answer: "x" }];
    expect(searchFaqItems(rows, "what’s cafe")).toEqual(rows);
  });
  it("has only plain ASCII in its source, so the built script survives any decoding", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("lib/chatFaq.ts", "utf8")).toMatch(/^[\x00-\x7f]*$/);
  });
  it("treats what is typed as text, not a pattern", () => {
    expect(searchFaqItems(items, ".*")).toEqual([]);
  });
  it("finds nothing that isn't in the items it is given", () => {
    expect(searchFaqItems(items, "quokka")).toEqual([]);
  });
});

describe("parseFaqItemInput", () => {
  it("keeps the answer's line breaks and puts the question on one line", () => {
    expect(parseFaqItemInput({ question: " A\n question ", answer: "  one\r\n\r\ntwo\n " })).toEqual({
      ok: true,
      value: { question: "A question", answer: "one\n\ntwo" },
    });
  });
  it("refuses empty, too long or malformed input", () => {
    for (const body of [null, {}, { question: "q" }, { answer: "a" }, { question: " ", answer: "a" }, { question: "q", answer: 4 },
      { question: "q".repeat(FAQ_QUESTION_MAX + 1), answer: "a" }, { question: "q", answer: "a".repeat(FAQ_ANSWER_MAX + 1) }])
      expect(parseFaqItemInput(body).ok).toBe(false);
  });
});

describe("topics (#338)", () => {
  it("reads Topic - Question, and an item with no topic reads as before", () => {
    expect(faqItemTitle({ question: "How do I turn on phone notifications?", topic: "Phone Notifications" })).toBe("Phone Notifications - How do I turn on phone notifications?");
    expect(faqItemTitle({ question: "Plain?", topic: null })).toBe("Plain?");
    expect(faqItemTitle({ question: "Plain?" })).toBe("Plain?");
  });
  it("searches the topic too", () => {
    const rows = [{ id: "a", question: "Q", answer: "A", topic: "Margin Calls" }, { id: "b", question: "Q", answer: "A", topic: null }];
    expect(searchFaqItems(rows, "margin").map((row) => row.id)).toEqual(["a"]);
  });
  it("keeps a topic left out, clears a blank one and limits a long one", () => {
    expect(parseFaqItemInput({ question: "q", answer: "a" })).toEqual({ ok: true, value: { question: "q", answer: "a" } });
    expect(parseFaqItemInput({ question: "q", answer: "a", topic: "  " })).toEqual({ ok: true, value: { question: "q", answer: "a", topic: null } });
    expect(parseFaqItemInput({ question: "q", answer: "a", topic: " Big \n Topic " })).toEqual({ ok: true, value: { question: "q", answer: "a", topic: "Big Topic" } });
    expect(parseFaqItemInput({ question: "q", answer: "a", topic: "t".repeat(FAQ_TOPIC_MAX + 1) }).ok).toBe(false);
    expect(parseFaqItemInput({ question: "q", answer: "a", topic: 4 }).ok).toBe(false);
  });
});

describe("parseFaqSuggestion", () => {
  it("collapses to one line, takes either field name and must fit as a FAQ question", () => {
    expect(parseFaqSuggestion({ topic: " a\nb " })).toEqual({ ok: true, value: "a b" });
    expect(parseFaqSuggestion({ question: "c" })).toEqual({ ok: true, value: "c" });
    expect(parseFaqSuggestion({ topic: "" }).ok).toBe(false);
    expect(parseFaqSuggestion({ topic: "t".repeat(FAQ_QUESTION_MAX + 1) }).ok).toBe(false);
  });
});

describe("parseFaqReview", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const actor = { id: "m1", name: "Rob" };
  const full = { id, actor, action: "approve", question: "Q?", topic: "T", answer: "A" };
  it("takes a full approval and a bare rejection", () => {
    expect(parseFaqReview(full)).toEqual({ ok: true, value: { id, action: "approve", actorName: "Rob", actorRef: "m1", question: "Q?", topic: "T", answer: "A" } });
    expect(parseFaqReview({ id, actor, action: "reject" })).toEqual({ ok: true, value: { id, action: "reject", actorName: "Rob", actorRef: "m1" } });
  });
  it("won't approve without a question, topic and answer", () => {
    for (const blank of [{ question: " " }, { topic: " " }, { topic: undefined }, { answer: "" }, { answer: undefined }]) expect(parseFaqReview({ ...full, ...blank }).ok).toBe(false);
  });
  it("needs a real id, a known action and someone acting", () => {
    for (const body of [null, { ...full, id: "nope" }, { ...full, action: "publish" }, { ...full, actor: undefined }, { ...full, actor: { name: "Rob" } }, { ...full, actor: { id: "m1", name: " " } }]) expect(parseFaqReview(body).ok).toBe(false);
  });
});
